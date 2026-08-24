import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { vendorPartPrice } from "@/db/schema";
import { setCurrentPrice } from "@/lib/vendorPricing";

// GET /api/vendor-part-prices?vendorId=&sku=&current=1
//   No filters      → every row, newest first.
//   vendorId / sku  → narrow to that vendor and/or SKU.
//   current=1       → only the open (effective_to IS NULL) rows.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const vendorId = url.searchParams.get("vendorId");
  const sku = url.searchParams.get("sku");
  const currentOnly = url.searchParams.get("current") === "1";

  const filters = [];
  if (vendorId) filters.push(eq(vendorPartPrice.vendorId, vendorId));
  if (sku) filters.push(eq(vendorPartPrice.sku, sku));
  if (currentOnly) filters.push(isNull(vendorPartPrice.effectiveTo));

  const rows = await db
    .select()
    .from(vendorPartPrice)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(vendorPartPrice.effectiveFrom), desc(vendorPartPrice.createdAt));
  return NextResponse.json(rows);
}

// POST /api/vendor-part-prices
//   { vendorId, sku, cost, sourceNote? }
// Sets the current à la carte cost, preserving history: closes the prior
// current row and inserts a new one. A no-op (same cost) returns changed:false.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body?.vendorId || !body?.sku || body?.cost == null) {
    return NextResponse.json({ error: "vendorId, sku and cost are required" }, { status: 400 });
  }
  try {
    const result = await setCurrentPrice({
      vendorId: String(body.vendorId),
      sku: String(body.sku),
      cost: body.cost,
      sourceNote: body.sourceNote ?? null,
    });
    return NextResponse.json(result, { status: result.changed ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
