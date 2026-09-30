import { NextResponse } from "next/server";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { parts, vendors } from "@/db/schema";

export const dynamic = "force-dynamic";

// GET /api/parts/manufacturers — the Add Line Item picker's left column:
// every manufacturer that has active parts, with its part count (most parts
// first), plus the total and the count of parts with no manufacturer set.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select({ id: vendors.id, name: vendors.name, count: count(parts.id) })
    .from(parts)
    .innerJoin(vendors, eq(vendors.id, parts.manufacturerId))
    .where(eq(parts.archived, false))
    .groupBy(vendors.id, vendors.name)
    .orderBy(desc(count(parts.id)), vendors.name);

  const [{ n: unassigned }] = await db
    .select({ n: count() })
    .from(parts)
    .where(and(eq(parts.archived, false), isNull(parts.manufacturerId)));

  const total = rows.reduce((s, r) => s + Number(r.count), 0) + Number(unassigned);
  return NextResponse.json({
    total,
    unassigned: Number(unassigned),
    manufacturers: rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })),
  });
}
