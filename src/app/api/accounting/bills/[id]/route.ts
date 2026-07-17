import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { bills } from "@/db/schema";
import { paidCentsForBill, voidBill } from "@/lib/ap";
import { LedgerError } from "@/lib/accounting";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const { id } = await params;

  const bill = await db.query.bills.findFirst({ where: eq(bills.id, id) });
  if (!bill) return NextResponse.json({ error: "not found" }, { status: 404 });
  const paidCents = await paidCentsForBill(id);
  return NextResponse.json({ ...bill, paidCents, balanceCents: bill.totalCents - paidCents });
}

// Void (soft-delete) a bill: reverses its ledger entry, keeps history.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const { id } = await params;

  try {
    await voidBill(id, session!.user!.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof LedgerError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
