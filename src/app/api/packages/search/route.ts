import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { packages } from "@/db/schema";

export const dynamic = "force-dynamic";

// Type-ahead package lookup for the quote editor's "+ Add package" control.
// Matches name + category; excludes archived packages. Returns the full
// components array so the editor can expand the bundle onto the quote without
// a second round-trip. Capped at 25 rows. An empty query returns the first
// page so the control doubles as a browse dropdown.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 15));

  const filters = [eq(packages.archived, false)];
  if (q) {
    const like = `%${q}%`;
    const orCond = or(ilike(packages.name, like), ilike(packages.category, like));
    if (orCond) filters.push(orCond);
  }

  const rows = await db
    .select({
      id: packages.id,
      name: packages.name,
      category: packages.category,
      description: packages.description,
      components: packages.components,
    })
    .from(packages)
    .where(and(...filters))
    .orderBy(asc(packages.name))
    .limit(limit);

  return NextResponse.json(rows);
}
