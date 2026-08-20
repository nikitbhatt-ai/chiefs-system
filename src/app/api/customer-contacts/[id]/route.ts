import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { customerContacts } from "@/db/schema";
import { normalizeEmail } from "@/lib/communications";
import { canDelete } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [row] = await db.select().from(customerContacts).where(eq(customerContacts.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("name" in body) patch.name = body.name ?? null;
  if ("title" in body) patch.title = body.title ?? null;
  if ("email" in body) patch.email = normalizeEmail(body.email);
  if ("phone" in body) patch.phone = body.phone ?? null;
  if ("isPrimary" in body) patch.isPrimary = !!body.isPrimary;
  if ("active" in body) patch.active = !!body.active;
  if ("notes" in body) patch.notes = body.notes ?? null;

  const [row] = await db
    .update(customerContacts)
    .set(patch)
    .where(eq(customerContacts.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  await db.delete(customerContacts).where(eq(customerContacts.id, id));
  return NextResponse.json({ ok: true });
}
