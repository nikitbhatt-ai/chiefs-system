import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(deals).orderBy(desc(deals.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const [row] = await db
    .insert(deals)
    .values({
      customerId: body.customerId ?? null,
      assignedTo: body.assignedTo ?? null,
      salesRep: body.salesRep ?? null,
      vehicleYear: body.vehicleYear ?? null,
      vehicleMake: body.vehicleMake ?? null,
      vehicleModel: body.vehicleModel ?? null,
      vin: body.vin ?? null,
      stage: body.stage ?? "prospect",
      referralSource: body.referralSource ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
