import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import { db } from "@/db";
import { vendorPartPrice } from "@/db/schema";
import { normalizeCost } from "@/lib/vendorPricing";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(vendorPartPrice).where(eq(vendorPartPrice.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

// PATCH is for CORRECTING an existing row in place (a typo'd cost, a source
// note), NOT for changing the live price — that goes through POST so the change
// is captured as a new dated row. Only source_note and alacarte_unit_cost are
// editable; the date range and identity are immutable here.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if ("sourceNote" in body) update.sourceNote = body.sourceNote ? String(body.sourceNote) : null;
  if ("cost" in body) {
    const c = normalizeCost(body.cost);
    if (c == null) return NextResponse.json({ error: "cost must be a non-negative number" }, { status: 400 });
    update.alacarteUnitCost = c;
  }
  const [row] = await db.update(vendorPartPrice).set(update).where(eq(vendorPartPrice.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  await db.delete(vendorPartPrice).where(eq(vendorPartPrice.id, id));
  return NextResponse.json({ ok: true });
}
