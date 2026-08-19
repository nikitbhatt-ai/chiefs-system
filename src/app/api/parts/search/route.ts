import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { parts } from "@/db/schema";

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
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 15));

  const filters = [eq(parts.archived, false)];
  if (q) {
    const like = `%${q}%`;
    const orCond = or(ilike(parts.sku, like), ilike(parts.name, like), ilike(parts.mfgPartNumber, like));
    if (orCond) filters.push(orCond);
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
    })
    .from(parts)
    .where(and(...filters))
    .orderBy(asc(parts.sku))
    .limit(limit);

  return NextResponse.json(rows);
}
