import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { createInvoiceFromWorkOrder } from "@/lib/invoices";

export const dynamic = "force-dynamic";

// GET /api/invoices — list of every invoice, newest first.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt));
  return NextResponse.json(rows);
}

// POST /api/invoices  { workOrderId }
// Idempotent per WO: returns the existing invoice's id if one already
// exists, or creates a new one snapshotting the linked quote.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const workOrderId = String(body?.workOrderId ?? "").trim();
  if (!workOrderId) return NextResponse.json({ error: "workOrderId is required" }, { status: 400 });

  const result = await createInvoiceFromWorkOrder(workOrderId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.invoiceId, documentNumber: result.documentNumber }, { status: 201 });
}
