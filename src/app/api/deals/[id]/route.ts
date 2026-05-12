import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { syncDealToWorkflow } from "@/lib/dealTriggers";

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
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of [
    "customerId",
    "assignedTo",
    "salesRep",
    "vehicleYear",
    "vehicleMake",
    "vehicleModel",
    "vin",
    "stage",
    "referralSource",
    "notes",
    "source",
    "subSource",
    "subSourceMeta",
  ]) {
    if (f in body) update[f] = body[f];
  }
  const [existing] = await db
    .select({ stage: deals.stage, sourceLocked: deals.sourceLocked })
    .from(deals)
    .where(eq(deals.id, id));
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Source lock: once a deal hits Won the marketing-attribution source is
  // frozen. Only manager/admin can edit it after that — anyone else trying
  // to change source / subSource / subSourceMeta is rejected so reporting
  // doesn't drift retroactively.
  const touchingSource = "source" in update || "subSource" in update || "subSourceMeta" in update;
  if (touchingSource && existing.sourceLocked) {
    const role = (session.user as { role?: string }).role;
    if (role !== "admin" && role !== "manager") {
      return NextResponse.json(
        { error: "Deal source is locked because the deal has been won. Only manager/admin can edit it." },
        { status: 403 },
      );
    }
  }

  const [row] = await db.update(deals).set(update).where(eq(deals.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (typeof update.stage === "string" && update.stage !== existing.stage) {
    await syncDealToWorkflow(id, String(update.stage), existing.stage);
  }
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.delete(deals).where(eq(deals.id, id));
  return NextResponse.json({ ok: true });
}
