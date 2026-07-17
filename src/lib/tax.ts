// Tax / government tracking — Phase 8.
//
// Tax liability is the Sales Tax Payable ledger account (2100). Invoicing a
// taxed quote credits it (Phase 2); remitting tax to the authority debits it.
// This module manages the configurable rate table, computes period filing
// summaries from the 2100 ledger activity, and posts remittances. It hardcodes
// no rates and gives no tax advice.

import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { taxRates, glAccounts, journalEntries, journalLines } from "@/db/schema";
import { postJournalEntry, LedgerError } from "@/lib/accounting";

const SALES_TAX_CODE = "2100"; // Sales Tax Payable
const CASH_CODE = "1000";

// ── Configurable rates ────────────────────────────────────────────────────────

export async function listTaxRates() {
  return db.select().from(taxRates).orderBy(asc(taxRates.jurisdiction));
}

export async function addTaxRate(jurisdiction: string, ratePct: string, notes?: string | null) {
  const j = jurisdiction.trim();
  if (!j) throw new LedgerError("Enter a jurisdiction name.");
  const pct = Number(String(ratePct).replace(/[%\s]/g, ""));
  if (!Number.isFinite(pct) || pct < 0) throw new LedgerError("Enter a valid rate percentage.");
  await db.insert(taxRates).values({ jurisdiction: j, ratePct: pct.toFixed(3), notes: notes ?? null });
}

export async function setTaxRateActive(id: string, isActive: boolean) {
  await db.update(taxRates).set({ isActive, updatedAt: new Date() }).where(eq(taxRates.id, id));
}

// ── Filing summary from the ledger ────────────────────────────────────────────

async function accountId(code: string): Promise<string> {
  const [row] = await db.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code)).limit(1);
  if (!row) throw new LedgerError(`Chart of accounts is missing account ${code}. Run docs/sql/accounting_phase1.sql in Neon.`);
  return row.id;
}

/** Posted debit/credit totals on Sales Tax Payable within [from, to]. */
async function salesTaxActivity(from: Date, to: Date) {
  const [row] = await db
    .select({
      debit: sql<number>`COALESCE(SUM(${journalLines.debitCents}), 0)`.mapWith(Number),
      credit: sql<number>`COALESCE(SUM(${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(
      and(
        sql`${glAccounts.code} = ${SALES_TAX_CODE}`,
        eq(journalEntries.status, "posted"),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
      ),
    );
  return { debit: row?.debit ?? 0, credit: row?.credit ?? 0 };
}

/** Sales Tax Payable balance (credit − debit) as of the end of `asOf`. */
async function salesTaxBalance(asOf: Date): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${journalLines.creditCents} - ${journalLines.debitCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(sql`${glAccounts.code} = ${SALES_TAX_CODE}`, eq(journalEntries.status, "posted"), lte(journalEntries.entryDate, asOf)))
    .limit(1);
  return row?.cents ?? 0;
}

export type TaxSummary = {
  from: Date;
  to: Date;
  collectedCents: number; // tax charged on invoices this period (credits)
  remittedCents: number; // tax paid to the authority this period (debits)
  openingLiabilityCents: number; // owed at start of period
  closingLiabilityCents: number; // owed at end of period
};

/** Sales-tax filing summary for a period, straight from the 2100 ledger. */
export async function taxSummary(from: Date, to: Date): Promise<TaxSummary> {
  const dayBefore = new Date(from.getTime() - 1);
  const [activity, opening, closing] = await Promise.all([
    salesTaxActivity(from, to),
    salesTaxBalance(dayBefore),
    salesTaxBalance(to),
  ]);
  return {
    from,
    to,
    collectedCents: activity.credit,
    remittedCents: activity.debit,
    openingLiabilityCents: opening,
    closingLiabilityCents: closing,
  };
}

// ── Record a remittance ────────────────────────────────────────────────────────

/** Pay collected sales tax to the authority: Dr Sales Tax Payable / Cr Cash. */
export async function recordTaxRemittance(opts: {
  amountCents: number;
  paymentDate?: Date;
  jurisdiction?: string | null;
  memo?: string | null;
  createdBy?: string | null;
}) {
  const amountCents = Math.round(opts.amountCents);
  if (amountCents <= 0) throw new LedgerError("Remittance amount must be greater than zero.");
  const [taxId, cashId] = await Promise.all([accountId(SALES_TAX_CODE), accountId(CASH_CODE)]);
  const memo = `Sales tax remittance${opts.jurisdiction ? ` — ${opts.jurisdiction}` : ""}${opts.memo ? ` (${opts.memo})` : ""}`;
  return postJournalEntry({
    entryDate: opts.paymentDate ?? new Date(),
    memo,
    source: "system",
    createdBy: opts.createdBy ?? null,
    lines: [
      { accountId: taxId, debitCents: amountCents, memo: "Sales tax paid to authority" },
      { accountId: cashId, creditCents: amountCents, memo: "Cash" },
    ],
  });
}
