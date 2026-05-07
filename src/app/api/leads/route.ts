import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { leads } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(leads).orderBy(desc(leads.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const [row] = await db
    .insert(leads)
    .values({
      name: body.name.trim(),
      email: body.email ?? null,
      phone: body.phone ?? null,
      source: body.source ?? null,
      status: body.status ?? "new",
      notes: body.notes ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
