import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { arInvoices } from "@/db/schema";
import { issueInvoiceFromQuote } from "@/lib/ar";
import { LedgerError } from "@/lib/accounting";

export async function GET() {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;
  const rows = await db.select().from(arInvoices).orderBy(desc(arInvoices.invoiceDate)).limit(200);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || !body.quoteId) {
    return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
  }

  try {
    const invoice = await issueInvoiceFromQuote({
      quoteId: String(body.quoteId),
      invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : undefined,
      terms: body.terms ? String(body.terms) : undefined,
      memo: body.memo ? String(body.memo) : null,
      createdBy: session!.user!.id,
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    const message = err instanceof LedgerError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
