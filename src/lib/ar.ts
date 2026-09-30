// Accounts Receivable — Phase 2.
//
// Two operations, each of which BOTH writes a subledger row and posts a
// balanced journal entry, atomically:
//
//   Issue invoice (from a quote):  Dr Accounts Receivable   total
//                                    Cr Sales Revenue          subtotal
//                                    Cr Sales Tax Payable      tax
//   Record receipt (cash in):      Dr Cash                  amount
//                                    Cr Accounts Receivable   amount
//
// The chart-of-accounts codes below are the ones seeded by
// docs/sql/accounting_phase1.sql. We resolve them by code at runtime so the
// module keeps working even if the accounts get different UUIDs per environment.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  glAccounts,
  arInvoices,
  receipts,
  quotes,
  customers,
  parts,
  type QuoteLineItem,
} from "@/db/schema";
import { dollarsToCents, postJournalEntryTx, LedgerError, reverseJournalEntry } from "@/lib/accounting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACCOUNT_CODES = {
  ar: "1100", // Accounts Receivable
  cash: "1000", // Cash
  revenue: "4000", // Sales Revenue
  salesTax: "2100", // Sales Tax Payable
} as const;

/** Net terms → number of days until due. */
export const AR_TERMS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_60: 60,
};

export const AR_TERM_LABELS: Record<string, string> = {
  due_on_receipt: "Due on receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_60: "Net 60",
};

export const RECEIPT_METHODS = ["cash", "check", "card", "ach", "other"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

function dueDateFor(term: string, invoiceDate: Date): Date {
  const days = AR_TERMS[term] ?? 30;
  const d = new Date(invoiceDate);
  d.setDate(d.getDate() + days);
  return d;
}

async function accountIdByCode(tx: Tx, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: glAccounts.id })
    .from(glAccounts)
    .where(eq(glAccounts.code, code))
    .limit(1);
  if (!row) {
    throw new LedgerError(
      `Chart of accounts is missing account ${code}. Run docs/sql/accounting_phase1.sql in Neon.`,
    );
  }
  return row.id;
}

/** Next zero-padded document number for a table, e.g. "INV-0007". */
async function nextNumber(tx: Tx, prefix: string, countExpr: () => Promise<number>): Promise<string> {
  const n = await countExpr();
  return `${prefix}-${String(n + 1).padStart(4, "0")}`;
}

// ── Issue an invoice from a quote ─────────────────────────────────────────────

export type IssueInvoiceInput = {
  quoteId: string;
  invoiceDate?: Date;
  terms?: string;
  memo?: string | null;
  createdBy?: string | null;
};

export async function issueInvoiceFromQuote(input: IssueInvoiceInput) {
  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, input.quoteId) });
  if (!quote) throw new LedgerError("Quote not found.");
  if (!quote.customerId) throw new LedgerError("This quote has no customer — assign one before invoicing.");

  const already = await db
    .select({ id: arInvoices.id })
    .from(arInvoices)
    .where(eq(arInvoices.quoteId, input.quoteId))
    .limit(1);
  if (already.length) throw new LedgerError("This quote has already been invoiced.");

  const totalCents = dollarsToCents(quote.grandTotal);
  if (totalCents <= 0) throw new LedgerError("Quote total must be greater than zero to invoice.");
  // Derive revenue from total − tax so the entry always balances even if the
  // quote's stored subtotal drifted from grand − tax (discounts, rounding).
  const taxCents = Math.min(Math.max(0, dollarsToCents(quote.taxTotal)), totalCents);
  const revenueCents = totalCents - taxCents;

  const invoiceDate = input.invoiceDate ?? new Date();
  const terms = input.terms && input.terms in AR_TERMS ? input.terms : "net_30";
  const dueDate = dueDateFor(terms, invoiceDate);

  return db.transaction(async (tx) => {
    const arId = await accountIdByCode(tx, ACCOUNT_CODES.ar);
    const revId = await accountIdByCode(tx, ACCOUNT_CODES.revenue);
    const taxId = await accountIdByCode(tx, ACCOUNT_CODES.salesTax);

    const invoiceNumber = await nextNumber(tx, "INV", async () => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(arInvoices);
      return n;
    });

    const lines = [
      { accountId: arId, debitCents: totalCents, memo: `${invoiceNumber} — receivable` },
      { accountId: revId, creditCents: revenueCents, memo: `${invoiceNumber} — sales revenue` },
    ];
    if (taxCents > 0) lines.push({ accountId: taxId, creditCents: taxCents, memo: `${invoiceNumber} — sales tax` });

    const je = await postJournalEntryTx(tx, {
      entryDate: invoiceDate,
      memo: `Invoice ${invoiceNumber}${quote.quoteNumber ? ` (quote ${quote.quoteNumber})` : ""}`,
      source: "ar",
      createdBy: input.createdBy ?? null,
      lines,
    });

    const [invoice] = await tx
      .insert(arInvoices)
      .values({
        invoiceNumber,
        quoteId: quote.id,
        customerId: quote.customerId,
        invoiceDate,
        dueDate,
        terms,
        subtotalCents: revenueCents,
        taxCents,
        totalCents,
        status: "open",
        journalEntryId: je.id,
        memo: input.memo ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    // Snapshot each line's part avg_cost at sale time (Phase 2), so the internal
    // margin view reflects cost when invoiced, not today's moving average.
    const items = (quote.lineItems as QuoteLineItem[] | null) ?? [];
    const partIds = Array.from(new Set(items.map((i) => i.partId).filter((x): x is string => !!x)));
    if (partIds.length) {
      const rows = await tx
        .select({ id: parts.id, avgCost: parts.avgCost, cost: parts.cost })
        .from(parts)
        .where(inArray(parts.id, partIds));
      const avgById = new Map(
        rows.map((r) => [r.id, r.avgCost != null ? Number(r.avgCost) : r.cost != null ? Number(r.cost) : undefined]),
      );
      const snapped = items.map((i) => {
        const avg = i.partId ? avgById.get(i.partId) : undefined;
        return avg != null ? { ...i, avgCostSnap: avg } : i;
      });
      await tx.update(quotes).set({ lineItems: snapped as never, updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    }

    return invoice;
  });
}

// ── Record a receipt (cash in) ────────────────────────────────────────────────

export type RecordReceiptInput = {
  customerId: string;
  amountCents: number;
  receiptDate?: Date;
  method?: ReceiptMethod;
  reference?: string | null;
  invoiceId?: string | null;
  memo?: string | null;
  createdBy?: string | null;
};

export async function recordReceipt(input: RecordReceiptInput) {
  const amountCents = Math.round(input.amountCents);
  if (!input.customerId) throw new LedgerError("Pick a customer for this receipt.");
  if (amountCents <= 0) throw new LedgerError("Receipt amount must be greater than zero.");

  const receiptDate = input.receiptDate ?? new Date();
  const method: ReceiptMethod = RECEIPT_METHODS.includes(input.method as ReceiptMethod)
    ? (input.method as ReceiptMethod)
    : "check";

  return db.transaction(async (tx) => {
    // If applied to an invoice, sanity-check it belongs to this customer and is open.
    if (input.invoiceId) {
      const [inv] = await tx
        .select({ id: arInvoices.id, customerId: arInvoices.customerId, status: arInvoices.status })
        .from(arInvoices)
        .where(eq(arInvoices.id, input.invoiceId))
        .limit(1);
      if (!inv) throw new LedgerError("Invoice not found.");
      if (inv.status === "void") throw new LedgerError("Cannot apply a receipt to a voided invoice.");
      if (inv.customerId && inv.customerId !== input.customerId) {
        throw new LedgerError("That invoice belongs to a different customer.");
      }
    }

    const cashId = await accountIdByCode(tx, ACCOUNT_CODES.cash);
    const arId = await accountIdByCode(tx, ACCOUNT_CODES.ar);

    const receiptNumber = await nextNumber(tx, "RCPT", async () => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(receipts);
      return n;
    });

    const je = await postJournalEntryTx(tx, {
      entryDate: receiptDate,
      memo: `Receipt ${receiptNumber}`,
      source: "ar",
      createdBy: input.createdBy ?? null,
      lines: [
        { accountId: cashId, debitCents: amountCents, memo: `${receiptNumber} — cash` },
        { accountId: arId, creditCents: amountCents, memo: `${receiptNumber} — apply to AR` },
      ],
    });

    const [receipt] = await tx
      .insert(receipts)
      .values({
        receiptNumber,
        customerId: input.customerId,
        invoiceId: input.invoiceId ?? null,
        receiptDate,
        method,
        reference: input.reference ?? null,
        amountCents,
        memo: input.memo ?? null,
        journalEntryId: je.id,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    if (input.invoiceId) await refreshInvoiceStatus(tx, input.invoiceId);

    return receipt;
  });
}

/** Sum receipts applied to an invoice and flip open⇄paid (never touches void). */
async function refreshInvoiceStatus(tx: Tx, invoiceId: string) {
  const [inv] = await tx
    .select({ total: arInvoices.totalCents, status: arInvoices.status })
    .from(arInvoices)
    .where(eq(arInvoices.id, invoiceId))
    .limit(1);
  if (!inv || inv.status === "void") return;

  const [{ paid }] = await tx
    .select({ paid: sql<number>`COALESCE(SUM(${receipts.amountCents}), 0)`.mapWith(Number) })
    .from(receipts)
    .where(eq(receipts.invoiceId, invoiceId));

  const status = paid >= inv.total ? "paid" : "open";
  await tx.update(arInvoices).set({ status, updatedAt: new Date() }).where(eq(arInvoices.id, invoiceId));
}

// ── Void an invoice ───────────────────────────────────────────────────────────

/** Void an open invoice: reverse its ledger entry and mark it void. Blocked
 *  once any receipt has been applied — unapply/refund first. */
export async function voidInvoice(invoiceId: string, createdBy?: string | null) {
  const [inv] = await db
    .select({ id: arInvoices.id, status: arInvoices.status, journalEntryId: arInvoices.journalEntryId })
    .from(arInvoices)
    .where(eq(arInvoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new LedgerError("Invoice not found.");
  if (inv.status === "void") throw new LedgerError("Invoice is already void.");

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(receipts)
    .where(eq(receipts.invoiceId, invoiceId));
  if (n > 0) throw new LedgerError("This invoice has receipts applied — remove them before voiding.");

  // Reverse the original posting (keeps history intact), then mark void.
  if (inv.journalEntryId) await reverseJournalEntry(inv.journalEntryId, createdBy);
  await db.update(arInvoices).set({ status: "void", updatedAt: new Date() }).where(eq(arInvoices.id, invoiceId));
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/** Total cash applied to a given invoice. */
export async function paidCentsForInvoice(invoiceId: string): Promise<number> {
  const [{ paid }] = await db
    .select({ paid: sql<number>`COALESCE(SUM(${receipts.amountCents}), 0)`.mapWith(Number) })
    .from(receipts)
    .where(eq(receipts.invoiceId, invoiceId));
  return paid;
}

/** Quotes eligible to be invoiced: approved/converted, positive total, not yet invoiced. */
export async function invoiceableQuotes() {
  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      grandTotal: quotes.grandTotal,
      status: quotes.status,
      customerId: quotes.customerId,
      customerName: customers.name,
    })
    .from(quotes)
    .leftJoin(arInvoices, eq(arInvoices.quoteId, quotes.id))
    .leftJoin(customers, eq(customers.id, quotes.customerId))
    .where(
      and(
        sql`${arInvoices.id} IS NULL`,
        sql`${quotes.status} IN ('approved','converted')`,
        sql`${quotes.customerId} IS NOT NULL`,
        sql`COALESCE(${quotes.grandTotal}, '0')::numeric > 0`,
      ),
    )
    .orderBy(quotes.quoteNumber);
  return rows;
}
