// Accounts Payable — Phase 3.
//
// Two operations, each of which BOTH writes a subledger row and posts a
// balanced journal entry, atomically:
//
//   Create bill, NOT against a PO:       Dr <expense/asset account>  per line
//                                          Cr Accounts Payable         total
//   Create bill AGAINST a PO:            Dr Accrued Purchases 2050   received
//                                        Dr Price Variance 5150      any excess
//                                          Cr Accounts Payable         total
//   Record payment (cash out):           Dr Accounts Payable         amount
//                                          Cr Cash                     amount
//
// A PO bill relieves the accrual that receiving created rather than debiting an
// expense — the goods are already capitalised in Inventory, so expensing them
// here would book the same cost twice. That double-count is what this replaced.
//
// Chart-of-accounts codes are the ones seeded by accounting_phase1.sql; we
// resolve them by code at runtime.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { glAccounts, bills, billLines, payments, partReceipts } from "@/db/schema";
import {
  dollarsToCents,
  postJournalEntryTx,
  LedgerError,
  reverseJournalEntry,
  type JournalLineInput,
} from "@/lib/accounting";
import { AR_TERMS } from "@/lib/ar";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACCOUNT_CODES = {
  ap: "2000", // Accounts Payable
  cash: "1000", // Cash
  accrued: "2050", // Accrued Purchases (goods received, not yet invoiced)
  variance: "5150", // Purchase Price Variance
} as const;

// AP uses the same net-terms vocabulary as AR.
export { AR_TERMS as AP_TERMS, AR_TERM_LABELS as AP_TERM_LABELS } from "@/lib/ar";

export const PAYMENT_METHODS = ["check", "ach", "card", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function dueDateFor(term: string, billDate: Date): Date {
  const days = AR_TERMS[term] ?? 30;
  const d = new Date(billDate);
  d.setDate(d.getDate() + days);
  return d;
}

async function accountIdByCode(tx: Tx, code: string): Promise<string> {
  const [row] = await tx.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code)).limit(1);
  if (!row) {
    throw new LedgerError(`Chart of accounts is missing account ${code}. Run docs/sql/accounting_phase1.sql in Neon.`);
  }
  return row.id;
}

async function nextNumber(tx: Tx, prefix: string, count: () => Promise<number>): Promise<string> {
  const n = await count();
  return `${prefix}-${String(n + 1).padStart(4, "0")}`;
}

// ── Three-way match: PO → received → billed ───────────────────────────────────

/**
 * How much accrual is still outstanding on a purchase order, in cents:
 * value actually received, less what previous bills have already relieved.
 *
 * "Received" comes from `part_receipts`, not from the PO's line items — receipts
 * are append-only and record the unit cost at the moment goods arrived, whereas
 * PO lines stay editable, so a later price edit would otherwise change history.
 * This sum is exactly what `postInventoryReceipt` credited to 2050.
 *
 * "Already relieved" is the 2050 debits on prior non-void bills for the same PO,
 * rather than those bills' totals — a bill that ran over the received value only
 * relieved part of its total, with the rest going to variance.
 */
export async function accruedRemainingForPo(tx: Tx, purchaseOrderId: string): Promise<number> {
  const [received] = await tx
    .select({
      cents: sql<number>`COALESCE(SUM(${partReceipts.quantityReceived} * ROUND(${partReceipts.unitCost} * 100)), 0)`.mapWith(
        Number,
      ),
    })
    .from(partReceipts)
    .where(eq(partReceipts.purchaseOrderId, purchaseOrderId));

  const [relieved] = await tx
    .select({ cents: sql<number>`COALESCE(SUM(${billLines.amountCents}), 0)`.mapWith(Number) })
    .from(billLines)
    .innerJoin(bills, eq(bills.id, billLines.billId))
    .innerJoin(glAccounts, eq(glAccounts.id, billLines.accountId))
    .where(
      and(
        eq(bills.purchaseOrderId, purchaseOrderId),
        sql`${bills.status} <> 'void'`,
        eq(glAccounts.code, ACCOUNT_CODES.accrued),
      ),
    );

  return Math.max(0, (received?.cents ?? 0) - (relieved?.cents ?? 0));
}

/** Split a bill total against a PO's outstanding accrual. */
export function splitAgainstAccrual(billTotalCents: number, accruedRemainingCents: number) {
  // Bill within the accrual: relieve it all, leave the remainder accrued — a
  // partial bill against a partly-received PO is normal, not a variance.
  // Bill over the accrual: relieve what was received, the excess is a variance.
  const relieveCents = Math.min(billTotalCents, accruedRemainingCents);
  return { relieveCents, varianceCents: billTotalCents - relieveCents };
}

// ── Create a bill ─────────────────────────────────────────────────────────────

export type BillLineInput = {
  accountId: string;
  amountCents: number;
  description?: string | null;
  departmentId?: string | null;
  workOrderId?: string | null;
};

export type CreateBillInput = {
  vendorId: string;
  lines: BillLineInput[];
  billDate?: Date;
  dueDate?: Date;
  terms?: string;
  vendorInvoiceNumber?: string | null;
  purchaseOrderId?: string | null;
  memo?: string | null;
  createdBy?: string | null;
};

function validateBillLines(lines: BillLineInput[]): number {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new LedgerError("A bill needs at least one line.");
  }
  let total = 0;
  for (const [i, line] of lines.entries()) {
    if (!line.accountId) throw new LedgerError(`Line ${i + 1}: pick an account.`);
    const amt = Math.round(line.amountCents ?? 0);
    if (amt <= 0) throw new LedgerError(`Line ${i + 1}: amount must be greater than zero.`);
    total += amt;
  }
  return total;
}

export async function createBill(input: CreateBillInput) {
  if (!input.vendorId) throw new LedgerError("Pick a vendor for this bill.");
  const totalCents = validateBillLines(input.lines);

  const billDate = input.billDate ?? new Date();
  const terms = input.terms && input.terms in AR_TERMS ? input.terms : "net_30";
  const dueDate = input.dueDate ?? dueDateFor(terms, billDate);

  return db.transaction(async (tx) => {
    const apId = await accountIdByCode(tx, ACCOUNT_CODES.ap);

    const billNumber = await nextNumber(tx, "BILL", async () => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(bills);
      return n;
    });

    // A bill against a PO is settling goods already received and capitalised
    // into Inventory, so its GL side must relieve the accrual — NOT debit an
    // expense account, which would book the same cost a second time. The
    // caller's line accounts are overridden for exactly that reason; their
    // descriptions and amounts are still kept as bill detail.
    //
    // A bill with no PO (rent, software, a sublet invoice) is unchanged: it
    // debits whatever accounts the caller picked.
    let jeLines: JournalLineInput[];
    let recordedLines: BillLineInput[];

    if (input.purchaseOrderId) {
      const accruedId = await accountIdByCode(tx, ACCOUNT_CODES.accrued);
      const accruedRemaining = await accruedRemainingForPo(tx, input.purchaseOrderId);
      const { relieveCents, varianceCents } = splitAgainstAccrual(totalCents, accruedRemaining);

      jeLines = [];
      recordedLines = [];
      if (relieveCents > 0) {
        jeLines.push({
          accountId: accruedId,
          debitCents: relieveCents,
          memo: `${billNumber} — relieve accrued purchases`,
        });
        recordedLines.push({
          accountId: accruedId,
          amountCents: relieveCents,
          description: input.lines[0]?.description ?? "Goods received against PO",
        });
      }
      if (varianceCents > 0) {
        // Billed more than was received. Surfacing the difference is the point:
        // absorbing it silently is how vendor overbilling gets paid.
        const varianceId = await accountIdByCode(tx, ACCOUNT_CODES.variance);
        jeLines.push({
          accountId: varianceId,
          debitCents: varianceCents,
          memo: `${billNumber} — price variance vs received`,
        });
        recordedLines.push({
          accountId: varianceId,
          amountCents: varianceCents,
          description: "Billed over received value (price variance)",
        });
      }
    } else {
      jeLines = input.lines.map((l) => ({
        accountId: l.accountId,
        debitCents: Math.round(l.amountCents),
        departmentId: l.departmentId ?? null,
        workOrderId: l.workOrderId ?? null,
        memo: l.description ?? `${billNumber}`,
      }));
      recordedLines = input.lines;
    }

    jeLines.push({ accountId: apId, creditCents: totalCents, memo: `${billNumber} — payable` });

    const je = await postJournalEntryTx(tx, {
      entryDate: billDate,
      memo: `Bill ${billNumber}${input.vendorInvoiceNumber ? ` (vendor inv ${input.vendorInvoiceNumber})` : ""}`,
      source: "ap",
      createdBy: input.createdBy ?? null,
      lines: jeLines,
    });

    const [bill] = await tx
      .insert(bills)
      .values({
        billNumber,
        vendorId: input.vendorId,
        vendorInvoiceNumber: input.vendorInvoiceNumber ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        billDate,
        dueDate,
        terms,
        totalCents,
        status: "open",
        journalEntryId: je.id,
        memo: input.memo ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    await tx.insert(billLines).values(
      recordedLines.map((l) => ({
        billId: bill.id,
        accountId: l.accountId,
        description: l.description ?? null,
        amountCents: Math.round(l.amountCents),
        departmentId: l.departmentId ?? null,
        workOrderId: l.workOrderId ?? null,
      })),
    );

    return bill;
  });
}

// ── Record a payment (cash out) ───────────────────────────────────────────────

export type RecordPaymentInput = {
  vendorId: string;
  amountCents: number;
  paymentDate?: Date;
  method?: PaymentMethod;
  reference?: string | null;
  billId?: string | null;
  memo?: string | null;
  createdBy?: string | null;
};

export async function recordPayment(input: RecordPaymentInput) {
  const amountCents = Math.round(input.amountCents);
  if (!input.vendorId) throw new LedgerError("Pick a vendor for this payment.");
  if (amountCents <= 0) throw new LedgerError("Payment amount must be greater than zero.");

  const paymentDate = input.paymentDate ?? new Date();
  const method: PaymentMethod = PAYMENT_METHODS.includes(input.method as PaymentMethod)
    ? (input.method as PaymentMethod)
    : "check";

  return db.transaction(async (tx) => {
    if (input.billId) {
      const [bill] = await tx
        .select({ id: bills.id, vendorId: bills.vendorId, status: bills.status })
        .from(bills)
        .where(eq(bills.id, input.billId))
        .limit(1);
      if (!bill) throw new LedgerError("Bill not found.");
      if (bill.status === "void") throw new LedgerError("Cannot pay a voided bill.");
      if (bill.vendorId !== input.vendorId) throw new LedgerError("That bill belongs to a different vendor.");
    }

    const apId = await accountIdByCode(tx, ACCOUNT_CODES.ap);
    const cashId = await accountIdByCode(tx, ACCOUNT_CODES.cash);

    const paymentNumber = await nextNumber(tx, "PAY", async () => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(payments);
      return n;
    });

    const je = await postJournalEntryTx(tx, {
      entryDate: paymentDate,
      memo: `Payment ${paymentNumber}`,
      source: "ap",
      createdBy: input.createdBy ?? null,
      lines: [
        { accountId: apId, debitCents: amountCents, memo: `${paymentNumber} — settle AP` },
        { accountId: cashId, creditCents: amountCents, memo: `${paymentNumber} — cash out` },
      ],
    });

    const [payment] = await tx
      .insert(payments)
      .values({
        paymentNumber,
        vendorId: input.vendorId,
        billId: input.billId ?? null,
        paymentDate,
        method,
        reference: input.reference ?? null,
        amountCents,
        memo: input.memo ?? null,
        journalEntryId: je.id,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    if (input.billId) await refreshBillStatus(tx, input.billId);

    return payment;
  });
}

/** Sum payments applied to a bill and flip open⇄paid (never touches void). */
async function refreshBillStatus(tx: Tx, billId: string) {
  const [bill] = await tx
    .select({ total: bills.totalCents, status: bills.status })
    .from(bills)
    .where(eq(bills.id, billId))
    .limit(1);
  if (!bill || bill.status === "void") return;

  const [{ paid }] = await tx
    .select({ paid: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`.mapWith(Number) })
    .from(payments)
    .where(eq(payments.billId, billId));

  const status = paid >= bill.total ? "paid" : "open";
  await tx.update(bills).set({ status, updatedAt: new Date() }).where(eq(bills.id, billId));
}

// ── Void a bill ───────────────────────────────────────────────────────────────

/** Void an open bill: reverse its ledger entry and mark it void. Blocked once
 *  any payment has been applied. */
export async function voidBill(billId: string, createdBy?: string | null) {
  const [bill] = await db
    .select({ id: bills.id, status: bills.status, journalEntryId: bills.journalEntryId })
    .from(bills)
    .where(eq(bills.id, billId))
    .limit(1);
  if (!bill) throw new LedgerError("Bill not found.");
  if (bill.status === "void") throw new LedgerError("Bill is already void.");

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(payments)
    .where(eq(payments.billId, billId));
  if (n > 0) throw new LedgerError("This bill has payments applied — remove them before voiding.");

  if (bill.journalEntryId) await reverseJournalEntry(bill.journalEntryId, createdBy);
  await db.update(bills).set({ status: "void", updatedAt: new Date() }).where(eq(bills.id, billId));
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/** Total cash applied to a given bill. */
export async function paidCentsForBill(billId: string): Promise<number> {
  const [{ paid }] = await db
    .select({ paid: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`.mapWith(Number) })
    .from(payments)
    .where(eq(payments.billId, billId));
  return paid;
}

/** Parse a form dollar string to cents (re-exported for API convenience). */
export function billAmountToCents(input: string | number | null | undefined): number {
  return dollarsToCents(input);
}
