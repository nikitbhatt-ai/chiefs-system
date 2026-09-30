import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
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
  if ("barcode" in body) {
    const barcode = body.barcode != null ? String(body.barcode).trim() : "";
    // Linking a scanned code (Scan dialog) must not silently steal a barcode
    // already on another part — the next scan would become ambiguous.
    if (barcode) {
      const [taken] = await db
        .select({ sku: parts.sku })
        .from(parts)
        .where(and(sql`lower(${parts.barcode}) = lower(${barcode})`, ne(parts.id, id)))
        .limit(1);
      if (taken) {
        return NextResponse.json(
          { error: `Barcode ${barcode} is already on part ${taken.sku}`, code: "duplicate_barcode" },
          { status: 409 },
        );
      }
    }
    update.barcode = barcode || null;
  }
  const [row] = await db.update(parts).set(update).where(eq(parts.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(parts).where(eq(parts.id, id));
  return NextResponse.json({ ok: true });
}
