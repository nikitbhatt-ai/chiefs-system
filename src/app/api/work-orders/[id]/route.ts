import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import { db } from "@/db";
import { workOrders } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

// Generic field updates only. `status` is intentionally NOT writable here —
// stage moves must go through POST /api/quotes/[id]/workflow-stage so the QC
// build-close gate, FIFO consumption, and CRM sync all fire.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of ["customerId", "vehicleId", "assignedTo", "priority", "notes"]) {
    if (f in body) update[f] = body[f];
  }
  if ("safetyBufferDays" in body) {
    update.safetyBufferDays = Math.max(0, Number(body.safetyBufferDays) || 0);
  }
  if ("targetBuildStartDate" in body) {
    update.targetBuildStartDate = body.targetBuildStartDate ? new Date(body.targetBuildStartDate) : null;
  }
  const [row] = await db.update(workOrders).set(update).where(eq(workOrders.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(workOrders).where(eq(workOrders.id, id));
  return NextResponse.json({ ok: true });
}
