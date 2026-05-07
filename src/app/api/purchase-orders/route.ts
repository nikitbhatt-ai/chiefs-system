import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { purchaseOrders } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const poNumber = body.poNumber ?? `PO-${Date.now().toString().slice(-7)}`;
  const [row] = await db
    .insert(purchaseOrders)
    .values({
      poNumber,
      vendorId: body.vendorId ?? null,
      status: body.status ?? "pending",
      lineItems: body.lineItems ?? [],
      notes: body.notes ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
