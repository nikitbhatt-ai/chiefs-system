import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { bills } from "@/db/schema";
import { createBill, type BillLineInput } from "@/lib/ap";
import { dollarsToCents, LedgerError } from "@/lib/accounting";

export async function GET() {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const rows = await db.select().from(bills).orderBy(desc(bills.billDate)).limit(200);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || !body.vendorId || !Array.isArray(body.lines)) {
    return NextResponse.json({ error: "vendorId and lines are required" }, { status: 400 });
  }

  const lines: BillLineInput[] = body.lines.map((l: Record<string, unknown>) => ({
    accountId: String(l.accountId ?? ""),
    amountCents: typeof l.amountCents === "number" ? Math.round(l.amountCents) : dollarsToCents(l.amount as string),
    description: l.description ? String(l.description) : null,
    departmentId: l.departmentId ? String(l.departmentId) : null,
    workOrderId: l.workOrderId ? String(l.workOrderId) : null,
  }));

  try {
    const bill = await createBill({
      vendorId: String(body.vendorId),
      lines,
      billDate: body.billDate ? new Date(body.billDate) : undefined,
      terms: body.terms ? String(body.terms) : undefined,
      vendorInvoiceNumber: body.vendorInvoiceNumber ? String(body.vendorInvoiceNumber) : null,
      purchaseOrderId: body.purchaseOrderId ? String(body.purchaseOrderId) : null,
      memo: body.memo ? String(body.memo) : null,
      createdBy: session!.user!.id,
    });
    return NextResponse.json(bill, { status: 201 });
  } catch (err) {
    const message = err instanceof LedgerError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
