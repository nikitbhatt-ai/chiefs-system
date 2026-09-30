import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { quotes, workOrders } from "@/db/schema";
import { nextDocNumber, workOrderNumberForQuote } from "@/lib/docNumbers";

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

  // A work order raised against a quote shares that quote's number; a
  // standalone one draws its own job number.
  const quoteId = typeof body.quoteId === "string" ? body.quoteId : null;
  const [linkedQuote] = quoteId
    ? await db.select({ quoteNumber: quotes.quoteNumber }).from(quotes).where(eq(quotes.id, quoteId)).limit(1)
    : [undefined];
  const woNumber = await workOrderNumberForQuote(linkedQuote?.quoteNumber);
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
