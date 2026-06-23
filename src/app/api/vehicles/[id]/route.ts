import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import { db } from "@/db";
import { vehicles } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const fields = [
    "vin",
    "year",
    "make",
    "model",
    "trim",
    "color",
    "mileage",
    "status",
    "lotLocation",
    "notes",
  ];
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of fields) if (f in body) update[f] = body[f];
  if ("vin" in update && typeof update.vin === "string") {
    update.vin = update.vin.toUpperCase();
  }
  const [row] = await db
    .update(vehicles)
    .set(update)
    .where(eq(vehicles.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!canDelete(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(vehicles).where(eq(vehicles.id, id));
  return NextResponse.json({ ok: true });
}
