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
  const [row] = await db
    .insert(vehicles)
    .values({
      vin: body.vin?.toUpperCase() ?? null,
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
