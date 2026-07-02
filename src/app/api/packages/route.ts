import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { packages } from "@/db/schema";
import { sanitizeComponents } from "@/lib/packages";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(packages).orderBy(desc(packages.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const [row] = await db
    .insert(packages)
    .values({
      name,
      category: body.category ? String(body.category).trim() : null,
      description: body.description ? String(body.description).trim() : null,
      components: sanitizeComponents(body.components),
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
