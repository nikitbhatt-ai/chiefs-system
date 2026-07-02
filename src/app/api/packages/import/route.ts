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
    if (!pkg.name) errors.push("missing package_name");

    const components: PackageComponent[] = [];
    for (const r of pkg.rows) {
      // Row-level parse errors bubble up to the package (a partial bundle is
      // never imported — fix the row and re-run).
      for (const e of r.errors) errors.push(`row ${r.rowNumber}: ${e}`);
      if (r.errors.length > 0) continue;

      if (r.componentType === "item") {
        const part = partBySku.get(r.sku);
        if (!part) {
          errors.push(`row ${r.rowNumber}: unknown SKU "${r.sku}" (load inventory first)`);
          continue;
        }
        components.push({
          kind: "item",
          description: r.label || `${part.sku} — ${part.name}`,
          quantity: r.quantity != null ? Math.max(0, Math.trunc(r.quantity)) : 1,
          unitPrice: r.unitPrice != null ? r.unitPrice : part.price != null ? Number(part.price) : 0,
          partId: part.id,
          sku: part.sku,
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

    const nameKey = pkg.name.trim().toLowerCase();
    const existingIds = idsByName.get(nameKey) ?? [];
    if (existingIds.length > 1) {
      errors.push(`ambiguous — ${existingIds.length} existing packages named "${pkg.name}"`);
    }

    if (errors.length > 0) {
      results.push({ name: pkg.name || "(unnamed)", action: "skip", componentCount: components.length, errors });
      skipped++;
      continue;
    }

    const isUpdate = existingIds.length === 1;
    if (!commit) {
      results.push({ name: pkg.name, action: isUpdate ? "update" : "create", componentCount: components.length, errors: [] });
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
            updatedAt: new Date(),
          })
          .where(eq(packages.id, existingIds[0]));
        updated++;
        results.push({ name: pkg.name, action: "update", componentCount: components.length, errors: [] });
      } else {
        const [row] = await db
          .insert(packages)
          .values({ name: pkg.name, category: pkg.category, description: pkg.description, components })
          .returning({ id: packages.id });
        // Track the new name so a duplicate later in the same file updates it
        // instead of creating a second row.
        idsByName.set(nameKey, [row.id]);
        created++;
        results.push({ name: pkg.name, action: "create", componentCount: components.length, errors: [] });
      }
    } catch (e) {
      skipped++;
      results.push({
        name: pkg.name,
        action: "skip",
        componentCount: components.length,
        errors: [e instanceof Error ? e.message : "insert/update error"],
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
