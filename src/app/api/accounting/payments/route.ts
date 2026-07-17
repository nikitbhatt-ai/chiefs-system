import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { recordPayment, type PaymentMethod } from "@/lib/ap";
import { dollarsToCents, LedgerError } from "@/lib/accounting";

export async function GET() {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const rows = await db.select().from(payments).orderBy(desc(payments.paymentDate)).limit(200);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || !body.vendorId) {
    return NextResponse.json({ error: "vendorId is required" }, { status: 400 });
  }
  const amountCents =
    typeof body.amountCents === "number" ? Math.round(body.amountCents) : dollarsToCents(body.amount);

  try {
    const payment = await recordPayment({
      vendorId: String(body.vendorId),
      amountCents,
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
      method: body.method as PaymentMethod | undefined,
      reference: body.reference ? String(body.reference) : null,
      billId: body.billId ? String(body.billId) : null,
      memo: body.memo ? String(body.memo) : null,
      createdBy: session!.user!.id,
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    const message = err instanceof LedgerError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
