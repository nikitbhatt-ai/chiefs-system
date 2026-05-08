import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { parts, vendors } from "@/db/schema";
import { parseCsv, rowsToImport } from "@/lib/csv";

type Action = "create" | "update" | "skip";

type Result = {
  rowNumber: number;
  sku: string;
  name: string;
  action: Action;
  errors: string[];
  manufacturerCreated?: boolean;
  supplierCreated?: boolean;
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.csv !== "string") {
    return NextResponse.json({ error: "expected JSON { csv: string, commit?: boolean }" }, { status: 400 });
  }
  const commit = body.commit === true;

  const rows = parseCsv(body.csv);
  const { parsed, fatalError } = rowsToImport(rows);
  if (fatalError) {
    return NextResponse.json({ error: fatalError }, { status: 400 });
  }

  const skus = parsed.map((r) => r.sku).filter(Boolean);
  const existing = skus.length
    ? await db.select({ id: parts.id, sku: parts.sku }).from(parts).where(inArray(parts.sku, skus))
    : [];
  const skuToId = new Map(existing.map((r) => [r.sku, r.id]));

  const vendorNames = Array.from(
    new Set(
      parsed
        .flatMap((r) => [r.manufacturer, r.supplier])
        .filter((v): v is string => Boolean(v))
        .map((s) => s.trim()),
    ),
  );
  const existingVendors = vendorNames.length
    ? await db
        .select({ id: vendors.id, name: vendors.name })
        .from(vendors)
        .where(inArray(vendors.name, vendorNames))
    : [];
  const vendorMap = new Map(existingVendors.map((v) => [v.name.toLowerCase(), v.id]));
  const vendorsCreated: string[] = [];

  const wouldCreateVendor = (name: string) => !vendorMap.has(name.toLowerCase());

  async function ensureVendor(name: string): Promise<{ id: string; created: boolean }> {
    const existingId = vendorMap.get(name.toLowerCase());
    if (existingId) return { id: existingId, created: false };
    const [v] = await db.insert(vendors).values({ name }).returning({ id: vendors.id });
    vendorMap.set(name.toLowerCase(), v.id);
    vendorsCreated.push(name);
    return { id: v.id, created: true };
  }

  const results: Result[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of parsed) {
    const result: Result = {
      rowNumber: r.rowNumber,
      sku: r.sku,
      name: r.name,
      action: "skip",
      errors: [...r.errors],
    };
    if (r.errors.length > 0) {
      results.push(result);
      skipped++;
      continue;
    }

    const isUpdate = skuToId.has(r.sku);
    result.action = isUpdate ? "update" : "create";

    if (!commit) {
      if (r.manufacturer && wouldCreateVendor(r.manufacturer)) result.manufacturerCreated = true;
      if (r.supplier && wouldCreateVendor(r.supplier)) result.supplierCreated = true;
      if (isUpdate) updated++;
      else created++;
      results.push(result);
      continue;
    }

    let manufacturerId: string | null = null;
    let supplierId: string | null = null;
    try {
      if (r.manufacturer) {
        const v = await ensureVendor(r.manufacturer);
        manufacturerId = v.id;
        result.manufacturerCreated = v.created;
      }
      if (r.supplier) {
        const v = await ensureVendor(r.supplier);
        supplierId = v.id;
        result.supplierCreated = v.created;
      }

      const baseValues = {
        name: r.name,
        description: r.description,
        category: r.category,
        cost: r.internalCost,
        price: r.price,
        quantityOnHand: r.quantityOnHand,
        quantityOnOrder: r.quantityOnOrder,
        reorderPoint: r.reorderPoint,
        vendorId: supplierId,
        manufacturerId,
        updatedAt: new Date(),
      };

      if (isUpdate) {
        await db.update(parts).set(baseValues).where(eq(parts.sku, r.sku));
        updated++;
      } else {
        await db.insert(parts).values({ sku: r.sku, ...baseValues });
        created++;
      }
    } catch (e) {
      result.action = "skip";
      result.errors.push(e instanceof Error ? e.message : "unknown insert/update error");
      skipped++;
    }
    results.push(result);
  }

  return NextResponse.json({
    commit,
    totalRows: parsed.length,
    created,
    updated,
    skipped,
    vendorsCreated,
    results,
  });
}
