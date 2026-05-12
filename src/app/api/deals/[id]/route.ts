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
  ]) {
    if (f in body) update[f] = body[f];
  }
  const [existing] = await db.select({ stage: deals.stage }).from(deals).where(eq(deals.id, id));
  const [row] = await db.update(deals).set(update).where(eq(deals.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing && typeof update.stage === "string" && update.stage !== existing.stage) {
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
