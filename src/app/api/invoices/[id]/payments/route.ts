import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordInvoicePayment } from "@/lib/invoices";

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = ["cash", "check", "card", "ach", "other"] as const;
type Method = (typeof ALLOWED_METHODS)[number];

// POST /api/invoices/[id]/payments  { amount, method, reference?, notes? }
// Records one payment against the invoice. Server re-derives amount_paid /
// balance_due / status inside a transaction — the client shouldn't send
// aggregate figures.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }
  const method = String(body?.method ?? "").trim() as Method;
  if (!ALLOWED_METHODS.includes(method)) {
    return NextResponse.json({ error: `method must be one of ${ALLOWED_METHODS.join(", ")}` }, { status: 400 });
  }

  try {
    const result = await recordInvoicePayment({
      invoiceId: id,
      amount,
      method,
      reference: String(body?.reference ?? "").trim() || null,
      notes: String(body?.notes ?? "").trim() || null,
      receivedBy: session.user.id ?? null,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    console.error("record payment failed:", err);
    return NextResponse.json({ error: "payment failed", detail: String((err as Error).message ?? err) }, { status: 500 });
  }
}
