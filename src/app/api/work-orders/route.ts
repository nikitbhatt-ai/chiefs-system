import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { workOrders } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(workOrders).orderBy(desc(workOrders.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const woNumber = `WO-${Date.now().toString().slice(-7)}`;
  const [row] = await db
    .insert(workOrders)
    .values({
      woNumber,
      customerId: body.customerId ?? null,
      quoteId: body.quoteId ?? null,
      vehicleId: body.vehicleId ?? null,
      assignedTo: body.assignedTo ?? null,
      priority: body.priority ?? null,
      notes: body.notes ?? null,
      status: typeof body.status === "string" ? body.status : "open",
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
