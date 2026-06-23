import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import { db } from "@/db";
import { customers, customerType } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if ("type" in body && !customerType.enumValues.includes(body.type)) {
    return NextResponse.json({ error: "invalid customer type" }, { status: 400 });
  }
  const [row] = await db
    .update(customers)
    .set({
      ...("name" in body ? { name: body.name } : {}),
      ...("type" in body ? { type: body.type } : {}),
      ...("email" in body ? { email: body.email } : {}),
      ...("phone" in body ? { phone: body.phone } : {}),
      ...("address" in body ? { address: body.address } : {}),
      ...("taxExempt" in body ? { taxExempt: !!body.taxExempt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(customers).where(eq(customers.id, id));
  return NextResponse.json({ ok: true });
}
