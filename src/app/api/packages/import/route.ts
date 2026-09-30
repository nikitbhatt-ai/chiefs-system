import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { packages, parts, type PackageComponent } from "@/db/schema";
import { parsePackageCsv } from "@/lib/packagesCsv";

type Action = "create" | "update" | "skip";

type Result = {
  name: string;
  action: Action;
  componentCount: number;
  errors: string[];
  warnings: string[];
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.csv !== "string") {
    return NextResponse.json({ error: "expected JSON { csv: string, commit?: boolean }" }, { status: 400 });
  }
  const commit = body.commit === true;

  const { packages: parsed, fatalError } = parsePackageCsv(body.csv);
  if (fatalError) return NextResponse.json({ error: fatalError }, { status: 400 });

  // Resolve every referenced part SKU up front. Inventory must be loaded
  // first — a part row whose SKU isn't found is an error, not a silent skip.
  const skus = Array.from(
    new Set(parsed.flatMap((p) => p.rows.filter((r) => r.componentType === "item" && r.sku).map((r) => r.sku))),
  );
  const partRows = skus.length
    ? await db
        .select({ id: parts.id, sku: parts.sku, name: parts.name, price: parts.price })
        .from(parts)
        .where(inArray(parts.sku, skus))
    : [];
  const partBySku = new Map(partRows.map((p) => [p.sku, p]));

  // Existing packages by lowercased name, for upsert-by-name.
  const existingRows = await db.select({ id: packages.id, name: packages.name }).from(packages);
  const idsByName = new Map<string, string[]>();
  for (const row of existingRows) {
    const k = row.name.trim().toLowerCase();
    idsByName.set(k, [...(idsByName.get(k) ?? []), row.id]);
  }

  const results: Result[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const pkg of parsed) {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!pkg.name) errors.push("no package name — can't group these rows");

    const components: PackageComponent[] = [];
    for (const r of pkg.rows) {
      // A row-level hard error drops just that row (reported), never the whole
      // package — a partial bundle is better than a rejected upload.
      if (r.errors.length > 0) {
        warnings.push(`row ${r.rowNumber} dropped: ${r.errors.join("; ")}`);
        continue;
      }
      for (const w of r.warnings) warnings.push(`row ${r.rowNumber}: ${w}`);

      if (r.componentType === "item") {
        // Link to a catalog part when the SKU resolves; otherwise keep the
        // component but link by SKU snapshot only (partId null). A package can
        // reference a part not yet loaded into inventory — the snapshot means
        // it still carries a description and price and links up by SKU later.
        const part = r.sku ? partBySku.get(r.sku) : undefined;
        if (r.sku && !part) {
          warnings.push(`row ${r.rowNumber}: SKU "${r.sku}" not in inventory yet — linked by SKU only`);
        }
        const description = r.label || (part ? `${part.sku} — ${part.name}` : r.sku);
        components.push({
          kind: "item",
          description,
          quantity: r.quantity != null ? Math.max(0, Math.trunc(r.quantity)) : 1,
          unitPrice: r.unitPrice != null ? r.unitPrice : part?.price != null ? Number(part.price) : 0,
          partId: part?.id ?? null,
          sku: r.sku || null,
        });
      } else if (r.componentType === "labor") {
        components.push({
          kind: "labor",
          description: r.label || "Labor",
          hours: r.hours ?? 0,
          rate: r.rate ?? 0,
        });
      } else if (r.componentType === "fee") {
        components.push({
          kind: "fee",
          description: r.label || "Fee",
          amount: r.amount ?? 0,
          fixed: false,
        });
      }
    }

    const nameKey = (pkg.name || "").trim().toLowerCase();
    const existingIds = pkg.name ? idsByName.get(nameKey) ?? [] : [];
    if (existingIds.length > 1) {
      errors.push(`ambiguous — ${existingIds.length} existing packages named "${pkg.name}"`);
    }
    // A package with no usable components is nothing to import — skip it, but
    // as its own reported row, not a file failure.
    if (errors.length === 0 && components.length === 0) {
      errors.push("no usable components in this package");
    }

    if (errors.length > 0) {
      results.push({ name: pkg.name || "(unnamed)", action: "skip", componentCount: components.length, errors, warnings });
      skipped++;
      continue;
    }

    const isUpdate = existingIds.length === 1;
    if (!commit) {
      results.push({ name: pkg.name, action: isUpdate ? "update" : "create", componentCount: components.length, errors: [], warnings });
      if (isUpdate) updated++;
      else created++;
      continue;
    }

    try {
      if (isUpdate) {
        await db
          .update(packages)
          .set({
            category: pkg.category,
            description: pkg.description,
            components,
            packagePrice: pkg.packagePrice != null ? pkg.packagePrice.toFixed(2) : null,
            updatedAt: new Date(),
          })
          .where(eq(packages.id, existingIds[0]));
        updated++;
        results.push({ name: pkg.name, action: "update", componentCount: components.length, errors: [], warnings });
      } else {
        const [row] = await db
          .insert(packages)
          .values({
            name: pkg.name,
            category: pkg.category,
            description: pkg.description,
            components,
            packagePrice: pkg.packagePrice != null ? pkg.packagePrice.toFixed(2) : null,
          })
          .returning({ id: packages.id });
        // Track the new name so a duplicate later in the same file updates it
        // instead of creating a second row.
        idsByName.set(nameKey, [row.id]);
        created++;
        results.push({ name: pkg.name, action: "create", componentCount: components.length, errors: [], warnings });
      }
    } catch (e) {
      skipped++;
      results.push({
        name: pkg.name,
        action: "skip",
        componentCount: components.length,
        errors: [e instanceof Error ? e.message : "insert/update error"],
        warnings,
      });
    }
  }

  return NextResponse.json({
    commit,
    totalPackages: parsed.length,
    created,
    updated,
    skipped,
    results,
  });
}
