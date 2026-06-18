import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete, canOverrideStageGate } from "@/lib/rbac";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { applyDealStageChange } from "@/lib/dealStage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(deals).where(eq(deals.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Stage changes must NOT be writable through this generic PATCH — that
  // bypassed canAdvanceTo, the credential hard gate, override auditing, and
  // the Won/sync triggers. Stage is routed through the single guarded
  // transition; every other field is a plain update.
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of [
    "customerId",
    "assignedTo",
    "salesRep",
    "vehicleYear",
    "vehicleMake",
    "vehicleModel",
    "vin",
    "referralSource",
    "notes",
  ]) {
    if (f in body) update[f] = body[f];
  }

  const [existing] = await db.select({ stage: deals.stage }).from(deals).where(eq(deals.id, id));
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Apply the non-stage fields (only if any were provided).
  if (Object.keys(update).length > 1) {
    await db.update(deals).set(update).where(eq(deals.id, id));
  }

  // Then handle a stage change through the guarded path, surfacing gate
  // failures to the caller instead of silently writing the column.
  if ("stage" in body && typeof body.stage === "string" && body.stage !== existing.stage) {
    if (body?.override === true && !canOverrideStageGate(session)) {
      return NextResponse.json({ error: "Only managers can override stage gates." }, { status: 403 });
    }
    const result = await applyDealStageChange(id, body.stage, {
      userId: session.user.id,
      override: body?.override === true,
      reason: body?.reason,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          overridable: result.overridable,
          requiresReason: result.requiresReason,
          backwards: result.backwards,
        },
        { status: result.status },
      );
    }
  }

  const [row] = await db.select().from(deals).where(eq(deals.id, id));
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(deals).where(eq(deals.id, id));
  return NextResponse.json({ ok: true });
}
