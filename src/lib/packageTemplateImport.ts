// Package-template importer — turns one parsed template sheet into:
//   • à la carte price-list entries (vendor_part_price) from each part's Unit Cost
//   • ONE vendor_promo, allocated across all parts, when the sheet carries a
//     package price (else no promo — à la carte only)
//   • a sellable package (packages) with the parts, labor, and fees
// Missing parts are auto-created by SKU. The Notes column is ignored upstream.
//
// Runs in two modes: preview (dry-run, no writes) and commit.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  packages,
  parts,
  vendorPromo,
  vendorPromoLine,
  type PackageComponent,
} from "@/db/schema";
import { allocatePromo, PromoAllocationError } from "@/lib/promoAllocation";
import { setCurrentPrice } from "@/lib/vendorPricing";
import { parsePackageTemplateCsv, type ParsedTemplate } from "@/lib/packageTemplateCsv";

export type TemplateResult = {
  name: string;
  packageAction: "create" | "update" | "skip";
  itemCount: number;
  laborCount: number;
  feeCount: number;
  newPartCount: number;
  alacarteCount: number;
  promo: null | {
    packagePrice: number;
    alacarteTotal: number;
    saving: number;
    lineCount: number;
  };
  errors: string[];
  warnings: string[];
};

export type ImportResponse = {
  commit: boolean;
  vendorId: string;
  totalTemplates: number;
  created: number;
  updated: number;
  skipped: number;
  promosCreated: number;
  results: TemplateResult[];
};

const money = (n: number) => Number(n.toFixed(2));

export async function importPackageTemplates(opts: {
  csv: string;
  vendorId: string;
  commit: boolean;
}): Promise<{ error?: string; response?: ImportResponse }> {
  const { templates, fatalError } = parsePackageTemplateCsv(opts.csv);
  if (fatalError) return { error: fatalError };
  if (!opts.vendorId) return { error: "Pick the vendor these parts are bought from." };

  // Resolve every referenced SKU once.
  const allSkus = Array.from(
    new Set(templates.flatMap((t) => t.lines.filter((l) => l.kind === "item" && l.sku).map((l) => l.sku as string))),
  );
  const existing = allSkus.length
    ? await db.select({ id: parts.id, sku: parts.sku, name: parts.name }).from(parts).where(inArray(parts.sku, allSkus))
    : [];
  const partBySku = new Map(existing.map((p) => [p.sku, p]));

  // Existing packages by lowercased name, for upsert.
  const pkgRows = await db.select({ id: packages.id, name: packages.name }).from(packages);
  const pkgIdsByName = new Map<string, string[]>();
  for (const row of pkgRows) {
    const k = row.name.trim().toLowerCase();
    pkgIdsByName.set(k, [...(pkgIdsByName.get(k) ?? []), row.id]);
  }

  const results: TemplateResult[] = [];
  let created = 0,
    updated = 0,
    skipped = 0,
    promosCreated = 0;

  for (const tpl of templates) {
    const res = await processTemplate(tpl, {
      vendorId: opts.vendorId,
      commit: opts.commit,
      partBySku,
      pkgIdsByName,
    });
    results.push(res);
    if (res.packageAction === "create") created++;
    else if (res.packageAction === "update") updated++;
    else skipped++;
    if (opts.commit && res.promo) promosCreated++;
  }

  return {
    response: {
      commit: opts.commit,
      vendorId: opts.vendorId,
      totalTemplates: templates.length,
      created,
      updated,
      skipped,
      promosCreated,
      results,
    },
  };
}

async function processTemplate(
  tpl: ParsedTemplate,
  ctx: {
    vendorId: string;
    commit: boolean;
    partBySku: Map<string, { id: string; sku: string; name: string }>;
    pkgIdsByName: Map<string, string[]>;
  },
): Promise<TemplateResult> {
  const errors: string[] = [...tpl.warnings];
  const warnings: string[] = [];

  const items = tpl.lines.filter((l) => l.kind === "item");
  const labor = tpl.lines.filter((l) => l.kind === "labor");
  const fees = tpl.lines.filter((l) => l.kind === "fee");
  const partItems = items.filter((l) => l.sku);

  // New parts we'd create (SKU not yet in inventory).
  const newSkus = Array.from(new Set(partItems.filter((l) => !ctx.partBySku.has(l.sku as string)).map((l) => l.sku as string)));

  // à la carte prices to set (one per distinct SKU with a unit cost).
  const alacarteBySku = new Map<string, number>();
  for (const l of partItems) if (l.unitCost != null) alacarteBySku.set(l.sku as string, l.unitCost);

  // Promo plan — allocate the package price across parts with an à la carte cost.
  // A SKU can appear on several lines of a sheet (e.g. XI3JC as 4 roof + 2 grille):
  // the PROMO covers the combined quantity, so merge duplicates into one line.
  // (The sellable package keeps the lines separate — they're distinct placements.)
  let promo: TemplateResult["promo"] = null;
  const mergedBySku = new Map<string, { sku: string; quantity: number; alacarteCostSnap: number }>();
  for (const l of partItems) {
    if (l.unitCost == null) continue;
    const sku = l.sku as string;
    const prev = mergedBySku.get(sku);
    if (prev) {
      prev.quantity += l.qty;
      if (prev.alacarteCostSnap !== l.unitCost) {
        warnings.push(
          `SKU ${sku} appears with two different Unit Costs (${prev.alacarteCostSnap} and ${l.unitCost}) — used ${prev.alacarteCostSnap}`,
        );
      }
    } else {
      mergedBySku.set(sku, { sku, quantity: l.qty, alacarteCostSnap: l.unitCost });
    }
  }
  const promoLines = Array.from(mergedBySku.values());
  if (tpl.packagePrice != null) {
    if (promoLines.length === 0) {
      errors.push("package price given but no parts carry a Unit Cost to allocate against — promo not created");
    } else {
      const missingCost = partItems.filter((l) => l.unitCost == null);
      if (missingCost.length) {
        warnings.push(`${missingCost.length} part line(s) had no Unit Cost — excluded from the promo allocation`);
      }
      try {
        const alloc = allocatePromo({ packagePrice: tpl.packagePrice, freight: tpl.freight, lines: promoLines });
        promo = {
          packagePrice: alloc.effectivePackagePrice,
          alacarteTotal: alloc.totalBasis,
          saving: alloc.saving,
          lineCount: alloc.lines.length,
        };
      } catch (e) {
        const msg = e instanceof PromoAllocationError ? e.message : (e as Error).message;
        errors.push(`promo not created: ${msg}`);
      }
    }
  }

  // Package upsert decision.
  const nameKey = tpl.name.trim().toLowerCase();
  const existingIds = ctx.pkgIdsByName.get(nameKey) ?? [];
  if (existingIds.length > 1) {
    errors.push(`ambiguous — ${existingIds.length} existing packages named "${tpl.name}"`);
  }
  const isUpdate = existingIds.length === 1;

  const base: TemplateResult = {
    name: tpl.name,
    packageAction: errors.length ? "skip" : isUpdate ? "update" : "create",
    itemCount: items.length,
    laborCount: labor.length,
    feeCount: fees.length,
    newPartCount: newSkus.length,
    alacarteCount: alacarteBySku.size,
    promo,
    errors,
    warnings,
  };

  if (!ctx.commit || errors.length) return base;

  // ── Commit ──────────────────────────────────────────────────────────────────
  try {
    // 1) Create any missing parts (opening cost/price from the sheet).
    for (const sku of newSkus) {
      const line = partItems.find((l) => l.sku === sku)!;
      const [row] = await db
        .insert(parts)
        .values({
          sku,
          name: line.label,
          cost: line.unitCost != null ? line.unitCost.toFixed(2) : null,
          price: line.sellPrice != null ? line.sellPrice.toFixed(2) : null,
        })
        .onConflictDoNothing({ target: parts.sku })
        .returning({ id: parts.id, sku: parts.sku, name: parts.name });
      if (row) ctx.partBySku.set(sku, row);
      else {
        // Lost a race — read it back.
        const [got] = await db.select({ id: parts.id, sku: parts.sku, name: parts.name }).from(parts).where(eq(parts.sku, sku));
        if (got) ctx.partBySku.set(sku, got);
      }
    }

    // 2) à la carte prices (append-only; a no-op when unchanged).
    for (const [sku, cost] of alacarteBySku) {
      await setCurrentPrice({ vendorId: ctx.vendorId, sku, cost: money(cost), sourceNote: `Template: ${tpl.name}` });
    }

    // 3) Vendor promo (validated above; re-run inside for the stored lines).
    if (promo) {
      await db.transaction(async (tx) => {
        const [vp] = await tx
          .insert(vendorPromo)
          .values({
            vendorId: ctx.vendorId,
            name: tpl.name,
            packagePrice: (tpl.packagePrice as number).toFixed(2),
            freight: tpl.freight != null ? tpl.freight.toFixed(2) : null,
            notes: "Imported from package template",
          })
          .returning({ id: vendorPromo.id });
        await tx.insert(vendorPromoLine).values(
          promoLines.map((l) => ({
            promoId: vp.id,
            sku: l.sku,
            quantity: l.quantity,
            alacarteCostSnap: l.alacarteCostSnap.toFixed(2),
          })),
        );
      });
    }

    // 4) Sellable package (components: items + labor + fees).
    const components: PackageComponent[] = [];
    for (const l of items) {
      const part = l.sku ? ctx.partBySku.get(l.sku) : undefined;
      components.push({
        kind: "item",
        description: l.label || (part ? `${part.sku} — ${part.name}` : l.sku ?? "(item)"),
        quantity: l.qty,
        unitPrice: l.sellPrice ?? 0,
        partId: part?.id ?? null,
        sku: l.sku ?? null,
      });
    }
    for (const l of labor) components.push({ kind: "labor", description: l.label, hours: l.hours ?? 0, rate: 0 });
    for (const l of fees) components.push({ kind: "fee", description: l.label, amount: l.sellPrice ?? 0, fixed: false });

    if (isUpdate) {
      await db.update(packages).set({ components, updatedAt: new Date() }).where(eq(packages.id, existingIds[0]));
    } else {
      const [row] = await db.insert(packages).values({ name: tpl.name, components }).returning({ id: packages.id });
      ctx.pkgIdsByName.set(nameKey, [row.id]);
    }

    return base;
  } catch (e) {
    return { ...base, packageAction: "skip", errors: [...errors, (e as Error).message] };
  }
}
