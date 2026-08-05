import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import {
  getPromoWithLines,
  allocationInputFor,
  setPromoStatus,
  deletePromo,
} from "@/lib/promos";
import { allocatePromo, PromoAllocationError } from "@/lib/promoAllocation";

// GET /api/vendor-promos/[id] — promo, lines, and the live allocation (or the
// allocation error, if the snapshot basis no longer allocates).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const pwl = await getPromoWithLines(id);
  if (!pwl) return NextResponse.json({ error: "not found" }, { status: 404 });

  let allocation = null;
  let allocationError: string | null = null;
  try {
    allocation = allocatePromo(allocationInputFor(pwl));
  } catch (e) {
    allocationError = e instanceof PromoAllocationError ? e.message : (e as Error).message;
  }
  return NextResponse.json({ ...pwl, allocation, allocationError });
}

// PATCH /api/vendor-promos/[id]  { status: 'active' | 'retired' }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body?.status;
  if (status !== "active" && status !== "retired") {
    return NextResponse.json({ error: "status must be 'active' or 'retired'" }, { status: 400 });
  }
  await setPromoStatus(id, status);
  return NextResponse.json({ ok: true });
}

// DELETE /api/vendor-promos/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  await deletePromo(id);
  return NextResponse.json({ ok: true });
}
