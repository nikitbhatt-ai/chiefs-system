import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { customers, deals } from "@/db/schema";
import { isPipelineSlug, pipelineForCustomerType, type DealStage } from "@/lib/pipelines";

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

  let pipeline: string | null = null;
  if (isPipelineSlug(body.pipeline)) {
    pipeline = body.pipeline;
  } else if (body.customerId) {
    const [c] = await db.select({ type: customers.type }).from(customers).where(eq(customers.id, body.customerId));
    pipeline = pipelineForCustomerType(c?.type);
  }

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
      stage: (body.stage as DealStage) ?? "prospect",
      pipeline,
      referralSource: body.referralSource ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
