import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { receipts } from "@/db/schema";
import { recordReceipt, type ReceiptMethod } from "@/lib/ar";
import { dollarsToCents, LedgerError } from "@/lib/accounting";

export async function GET() {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const rows = await db.select().from(receipts).orderBy(desc(receipts.receiptDate)).limit(200);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || !body.customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }
  // Accept either explicit cents or a dollar string from the form.
  const amountCents =
    typeof body.amountCents === "number" ? Math.round(body.amountCents) : dollarsToCents(body.amount);

  try {
    const receipt = await recordReceipt({
      customerId: String(body.customerId),
      amountCents,
      receiptDate: body.receiptDate ? new Date(body.receiptDate) : undefined,
      method: body.method as ReceiptMethod | undefined,
      reference: body.reference ? String(body.reference) : null,
      invoiceId: body.invoiceId ? String(body.invoiceId) : null,
      memo: body.memo ? String(body.memo) : null,
      createdBy: session!.user!.id,
    });
    return NextResponse.json(receipt, { status: 201 });
  } catch (err) {
    const message = err instanceof LedgerError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
