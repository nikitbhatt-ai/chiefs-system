import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { vendors } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(vendors).where(eq(vendors.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const [row] = await db
    .update(vendors)
    .set({
      ...("name" in body ? { name: body.name } : {}),
      ...("contactName" in body ? { contactName: body.contactName } : {}),
      ...("email" in body ? { email: body.email } : {}),
      ...("phone" in body ? { phone: body.phone } : {}),
      ...("address" in body ? { address: body.address } : {}),
      ...("notes" in body ? { notes: body.notes } : {}),
      ...("discountPct" in body
        ? { discountPct: body.discountPct != null ? String(body.discountPct) : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(vendors.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.delete(vendors).where(eq(vendors.id, id));
  return NextResponse.json({ ok: true });
}
