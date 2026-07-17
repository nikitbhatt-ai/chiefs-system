import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { arInvoices } from "@/db/schema";
import { paidCentsForInvoice, voidInvoice } from "@/lib/ar";
import { LedgerError } from "@/lib/accounting";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const { id } = await params;

  const invoice = await db.query.arInvoices.findFirst({ where: eq(arInvoices.id, id) });
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
  const paidCents = await paidCentsForInvoice(id);
  return NextResponse.json({ ...invoice, paidCents, balanceCents: invoice.totalCents - paidCents });
}

// Void (soft-delete) an invoice: reverses its ledger entry, keeps history.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const { id } = await params;

  try {
    await voidInvoice(id, session!.user!.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof LedgerError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
