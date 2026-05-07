import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { parts } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(parts).where(eq(parts.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of [
    "sku",
    "name",
    "description",
    "category",
    "quantityOnHand",
    "quantityOnOrder",
    "reorderPoint",
    "vendorId",
    "manufacturerId",
    "archived",
  ]) {
    if (f in body) update[f] = body[f];
  }
  for (const f of ["cost", "price"]) {
    if (f in body) update[f] = body[f] != null ? String(body[f]) : null;
  }
  const [row] = await db.update(parts).set(update).where(eq(parts.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.delete(parts).where(eq(parts.id, id));
  return NextResponse.json({ ok: true });
}
