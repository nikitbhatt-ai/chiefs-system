import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { vehicles } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(vehicles).orderBy(desc(vehicles.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  // `vehicles.vin` is NOT NULL — one durable row per VIN. Reject up front so
  // callers get a clear 400 instead of a raw constraint violation.
  const vin = String(body.vin ?? "").trim().toUpperCase();
  if (!vin) {
    return NextResponse.json({ error: "vin is required" }, { status: 400 });
  }
  const [row] = await db
    .insert(vehicles)
    .values({
      vin,
      year: body.year ?? null,
      make: body.make ?? null,
      model: body.model ?? null,
      trim: body.trim ?? null,
      color: body.color ?? null,
      mileage: body.mileage ?? null,
      status: body.status ?? "new",
      lotLocation: body.lotLocation ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
