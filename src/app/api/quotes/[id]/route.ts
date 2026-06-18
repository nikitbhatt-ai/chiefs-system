import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import { db } from "@/db";
import { quotes, quoteStatus } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of ["customerId", "dealId", "notes"]) {
    if (f in body) update[f] = body[f];
  }
  if ("lineItems" in body) {
    if (!Array.isArray(body.lineItems)) {
      return NextResponse.json({ error: "lineItems must be an array" }, { status: 400 });
    }
    update.lineItems = body.lineItems;
  }
  if ("status" in body) {
    if (!quoteStatus.enumValues.includes(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    update.status = body.status;
  }
  // Money fields must be finite, non-negative numbers — never coerce arbitrary
  // JSON via String() (which silently stored "[object Object]" / "NaN").
  for (const f of ["subtotal", "taxTotal", "grandTotal"]) {
    if (f in body) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `invalid ${f}` }, { status: 400 });
      }
      update[f] = n.toFixed(2);
    }
  }
  const [row] = await db
    .update(quotes)
    .set(update)
    .where(eq(quotes.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(quotes).where(eq(quotes.id, id));
  return NextResponse.json({ ok: true });
}
