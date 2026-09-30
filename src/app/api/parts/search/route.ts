import { NextResponse } from "next/server";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { parts, vendors } from "@/db/schema";
import { committedByPart } from "@/lib/partAvailability";

export const dynamic = "force-dynamic";

// Type-ahead part lookup for the quote / PO / estimate editors. Matches SKU,
// name, and manufacturer part number; excludes archived parts. With no query
// it returns the first page of parts so the control doubles as a browse
// dropdown. Capped at 25 rows so a huge catalog never floods the client.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
  // Add Line Item picker: ?manufacturerId=<vendor id> | none, and ?stock=1 to
  // include on-hand / committed / available counts.
  const manufacturerId = (url.searchParams.get("manufacturerId") ?? "").trim();
  const withStock = url.searchParams.get("stock") === "1";

  const filters = [eq(parts.archived, false)];
  if (manufacturerId === "none") filters.push(isNull(parts.manufacturerId));
  else if (/^[0-9a-f-]{36}$/i.test(manufacturerId)) filters.push(eq(parts.manufacturerId, manufacturerId));
  if (q) {
    // Match every whitespace-separated token (AND), each against any field
    // (sku, name, description, manufacturer part #, category). So "push bumper"
    // finds a part whose name/description contains both words, and a partial
    // SKU or a description keyword both work — not just SKU/name/mfg#.
    for (const tok of q.split(/\s+/).filter(Boolean)) {
      const like = `%${tok}%`;
      const orCond = or(
        ilike(parts.sku, like),
        ilike(parts.name, like),
        ilike(parts.description, like),
        ilike(parts.mfgPartNumber, like),
        ilike(parts.category, like),
        // A scanned barcode arrives as one token.
        ilike(parts.barcode, like),
      );
      if (orCond) filters.push(orCond);
    }
  }

  const rows = await db
    .select({
      id: parts.id,
      sku: parts.sku,
      name: parts.name,
      mfgPartNumber: parts.mfgPartNumber,
      price: parts.price,
      // `cost` is a 2dp mirror that only follows avg_cost when the receive path
      // updates it, so it goes stale and can be edited by hand. `avgCost` is the
      // authoritative weighted-average basis (numeric(12,4)) that job costing
      // uses. Both are returned: callers wanting an internal cost should prefer
      // avgCost and fall back to cost.
      cost: parts.cost,
      avgCost: parts.avgCost,
      restricted: parts.restricted,
      restrictionCategory: parts.restrictionCategory,
      description: parts.description,
      manufacturerId: parts.manufacturerId,
      manufacturerName: vendors.name,
      quantityOnHand: parts.quantityOnHand,
    })
    .from(parts)
    .leftJoin(vendors, eq(vendors.id, parts.manufacturerId))
    .where(and(...filters))
    .orderBy(asc(parts.sku))
    .limit(limit);

  if (!withStock) return NextResponse.json(rows);
  const committed = await committedByPart(rows.map((r) => r.id));
  return NextResponse.json(
    rows.map((r) => {
      const c = committed.get(r.id) ?? 0;
      return { ...r, committed: c, available: (r.quantityOnHand ?? 0) - c };
    }),
  );
}
