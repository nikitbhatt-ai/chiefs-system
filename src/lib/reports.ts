// Financial reporting — Phase 6. All read-only, computed from posted journal
// lines (the ledger is the single source of truth). Nothing here mutates data.
//
// Sign conventions (everything in integer cents):
//   • Revenue is a credit-normal account → income = credits − debits.
//   • Expenses are debit-normal → cost = debits − credits.
//   • Assets are debit-normal; liabilities & equity are credit-normal.

import { and, asc, eq, lte, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  glAccounts,
  journalEntries,
  journalLines,
  departments,
  arInvoices,
  receipts,
  bills,
  payments,
  customers,
  vendors,
} from "@/db/schema";

// ── Profit & Loss ─────────────────────────────────────────────────────────────

export type PnlRow = { code: string; name: string; amountCents: number };
export type PnlDeptRow = { departmentId: string | null; departmentName: string; amountCents: number };

export type PnlSegment = {
  revenue: PnlRow[];
  revenueTotal: number;
  /** COGS — parts & materials, by account. */
  cogsParts: PnlRow[];
  cogsPartsTotal: number;
  /** COGS — direct labor, by account. */
  cogsLabor: PnlRow[];
  cogsLaborTotal: number;
  /** COGS — variances and adjustments (e.g. 5900 Purchase Price Variance). */
  cogsOther: PnlRow[];
  cogsOtherTotal: number;
  cogsTotal: number;
  /** Revenue less COGS. The figure the accountant actually manages by. */
  grossProfitCents: number;
  /** Operating payroll & benefits, broken out by department. */
  laborByDept: PnlDeptRow[];
  laborTotal: number;
  otherExpense: PnlRow[];
  otherExpenseTotal: number;
  operatingTotal: number;
  netCents: number;
};

/** One P&L for [from, to] (inclusive of the day `to`). */
export async function pnlSegment(from: Date, to: Date): Promise<PnlSegment> {
  const inRange = and(
    eq(journalEntries.status, "posted"),
    gte(journalEntries.entryDate, from),
    lte(journalEntries.entryDate, to),
  );

  // Per-account revenue and other-expense totals.
  const rows = await db
    .select({
      code: glAccounts.code,
      name: glAccounts.name,
      reportGroup: glAccounts.reportGroup,
      debit: sql<number>`COALESCE(SUM(${journalLines.debitCents}), 0)`.mapWith(Number),
      credit: sql<number>`COALESCE(SUM(${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(inRange)
    .groupBy(glAccounts.id)
    .orderBy(asc(glAccounts.code));

  const revenue: PnlRow[] = [];
  const cogsParts: PnlRow[] = [];
  const cogsLabor: PnlRow[] = [];
  const cogsOther: PnlRow[] = [];
  const otherExpense: PnlRow[] = [];
  let revenueTotal = 0;
  let cogsPartsTotal = 0;
  let cogsLaborTotal = 0;
  let cogsOtherTotal = 0;
  let otherExpenseTotal = 0;
  for (const r of rows) {
    const credited = r.credit - r.debit;
    const debited = r.debit - r.credit;
    const push = (list: PnlRow[], amt: number) => {
      if (amt !== 0) list.push({ code: r.code, name: r.name, amountCents: amt });
    };
    switch (r.reportGroup) {
      case "revenue":
        push(revenue, credited);
        revenueTotal += credited;
        break;
      case "cogs_parts":
        push(cogsParts, debited);
        cogsPartsTotal += debited;
        break;
      case "cogs_labor":
        push(cogsLabor, debited);
        cogsLaborTotal += debited;
        break;
      case "cogs_other":
        push(cogsOther, debited);
        cogsOtherTotal += debited;
        break;
      case "operating_expense":
      // `other_expense` is the pre-Phase-11 group. Nothing is assigned to it any
      // more, but historical accounts still carry it and their balances must
      // keep appearing rather than silently vanishing from the P&L.
      case "other_expense":
        push(otherExpense, debited);
        otherExpenseTotal += debited;
        break;
      default:
        // "none" (balance sheet) and the labor groups, which are handled by the
        // department roll-up below.
        break;
    }
  }

  // Labor grouped by department (report_group = 'labor').
  const laborRows = await db
    .select({
      departmentId: journalLines.departmentId,
      departmentName: departments.name,
      debit: sql<number>`COALESCE(SUM(${journalLines.debitCents}), 0)`.mapWith(Number),
      credit: sql<number>`COALESCE(SUM(${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .leftJoin(departments, eq(departments.id, journalLines.departmentId))
    // admin_labor is the current group; 'labor' is the pre-Phase-11 value that
    // historical rows still carry.
    .where(and(inRange, sql`${glAccounts.reportGroup} IN ('admin_labor', 'labor')`))
    .groupBy(journalLines.departmentId, departments.name)
    .orderBy(asc(departments.name));

  const laborByDept: PnlDeptRow[] = [];
  let laborTotal = 0;
  for (const r of laborRows) {
    const amt = r.debit - r.credit;
    if (amt !== 0) laborByDept.push({ departmentId: r.departmentId, departmentName: r.departmentName ?? "Unassigned", amountCents: amt });
    laborTotal += amt;
  }

  const cogsTotal = cogsPartsTotal + cogsLaborTotal + cogsOtherTotal;
  const grossProfitCents = revenueTotal - cogsTotal;
  const operatingTotal = laborTotal + otherExpenseTotal;

  return {
    revenue,
    revenueTotal,
    cogsParts,
    cogsPartsTotal,
    cogsLabor,
    cogsLaborTotal,
    cogsOther,
    cogsOtherTotal,
    cogsTotal,
    grossProfitCents,
    laborByDept,
    laborTotal,
    otherExpense,
    otherExpenseTotal,
    operatingTotal,
    netCents: grossProfitCents - operatingTotal,
  };
}

export type ProfitAndLoss = {
  from: Date;
  to: Date;
  current: PnlSegment;
  prior: PnlSegment;
  priorFrom: Date;
  priorTo: Date;
};

/** P&L for the range plus the immediately-preceding period of equal length. */
export async function profitAndLoss(from: Date, to: Date): Promise<ProfitAndLoss> {
  const lengthMs = to.getTime() - from.getTime();
  const priorTo = new Date(from.getTime() - 1);
  const priorFrom = new Date(priorTo.getTime() - lengthMs);
  const [current, prior] = await Promise.all([pnlSegment(from, to), pnlSegment(priorFrom, priorTo)]);
  return { from, to, current, prior, priorFrom, priorTo };
}

// ── Aging ─────────────────────────────────────────────────────────────────────

export type AgingRow = {
  id: string;
  number: string;
  party: string; // customer or vendor name
  dueDate: Date;
  balanceCents: number;
  bucket: AgingBucket;
};
export type AgingBucket = "not_due" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
export const AGING_LABELS: Record<AgingBucket, string> = {
  not_due: "Not yet due",
  d1_30: "1–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90_plus: "90+",
};

function bucketFor(dueDate: Date, asOf: Date): AgingBucket {
  const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  if (days <= 0) return "not_due";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export type AgingReport = { rows: AgingRow[]; totals: Record<AgingBucket, number>; grandTotal: number };

function emptyTotals(): Record<AgingBucket, number> {
  return { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

/** AR aging: open invoices with a remaining balance, bucketed by days past due. */
export async function arAging(asOf: Date = new Date()): Promise<AgingReport> {
  const rows = await db
    .select({
      id: arInvoices.id,
      number: arInvoices.invoiceNumber,
      party: customers.name,
      dueDate: arInvoices.dueDate,
      totalCents: arInvoices.totalCents,
      paidCents: sql<number>`COALESCE((SELECT SUM(${receipts.amountCents}) FROM ${receipts} WHERE ${receipts.invoiceId} = ${arInvoices.id}), 0)`.mapWith(Number),
    })
    .from(arInvoices)
    .leftJoin(customers, eq(customers.id, arInvoices.customerId))
    .where(eq(arInvoices.status, "open"));
  return buildAging(rows, asOf);
}

/** AP aging: open bills with a remaining balance, bucketed by days past due. */
export async function apAging(asOf: Date = new Date()): Promise<AgingReport> {
  const rows = await db
    .select({
      id: bills.id,
      number: bills.billNumber,
      party: vendors.name,
      dueDate: bills.dueDate,
      totalCents: bills.totalCents,
      paidCents: sql<number>`COALESCE((SELECT SUM(${payments.amountCents}) FROM ${payments} WHERE ${payments.billId} = ${bills.id}), 0)`.mapWith(Number),
    })
    .from(bills)
    .leftJoin(vendors, eq(vendors.id, bills.vendorId))
    .where(eq(bills.status, "open"));
  return buildAging(rows, asOf);
}

function buildAging(
  raw: { id: string; number: string; party: string | null; dueDate: Date; totalCents: number; paidCents: number }[],
  asOf: Date,
): AgingReport {
  const totals = emptyTotals();
  let grandTotal = 0;
  const rows: AgingRow[] = [];
  for (const r of raw) {
    const balanceCents = r.totalCents - r.paidCents;
    if (balanceCents <= 0) continue;
    const bucket = bucketFor(r.dueDate, asOf);
    totals[bucket] += balanceCents;
    grandTotal += balanceCents;
    rows.push({ id: r.id, number: r.number, party: r.party ?? "—", dueDate: r.dueDate, balanceCents, bucket });
  }
  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return { rows, totals, grandTotal };
}

// ── Balance sheet ───────────────────────────────────────────────────────────

export type BsRow = { code: string; name: string; amountCents: number };
export type BalanceSheet = {
  asOf: Date;
  assets: BsRow[];
  assetsTotal: number;
  liabilities: BsRow[];
  liabilitiesTotal: number;
  equity: BsRow[];
  equityTotal: number;
  netIncomeCents: number; // current-period earnings folded into equity
  liabilitiesAndEquityTotal: number;
  balanced: boolean;
};

/** Balance sheet as of the end of `asOf`, built from all posted lines up to then. */
export async function balanceSheet(asOf: Date = new Date()): Promise<BalanceSheet> {
  const rows = await db
    .select({
      code: glAccounts.code,
      name: glAccounts.name,
      type: glAccounts.type,
      debit: sql<number>`COALESCE(SUM(${journalLines.debitCents}), 0)`.mapWith(Number),
      credit: sql<number>`COALESCE(SUM(${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.status, "posted"), lte(journalEntries.entryDate, asOf)))
    .groupBy(glAccounts.id)
    .orderBy(asc(glAccounts.code));

  const assets: BsRow[] = [];
  const liabilities: BsRow[] = [];
  const equity: BsRow[] = [];
  let assetsTotal = 0;
  let liabilitiesTotal = 0;
  let equityTotal = 0;
  let netIncomeCents = 0; // revenue − expenses to date → retained earnings

  for (const r of rows) {
    if (r.type === "asset") {
      const amt = r.debit - r.credit;
      if (amt !== 0) assets.push({ code: r.code, name: r.name, amountCents: amt });
      assetsTotal += amt;
    } else if (r.type === "liability") {
      const amt = r.credit - r.debit;
      if (amt !== 0) liabilities.push({ code: r.code, name: r.name, amountCents: amt });
      liabilitiesTotal += amt;
    } else if (r.type === "equity") {
      const amt = r.credit - r.debit;
      if (amt !== 0) equity.push({ code: r.code, name: r.name, amountCents: amt });
      equityTotal += amt;
    } else if (r.type === "revenue") {
      netIncomeCents += r.credit - r.debit;
    } else if (r.type === "expense" || r.type === "cogs") {
      // `cogs` is a distinct type as of Phase 11. Omitting it here would drop
      // Cost of Goods Sold out of retained earnings and unbalance the sheet.
      netIncomeCents -= r.debit - r.credit;
    }
  }

  // Current earnings live in equity until closed to retained earnings.
  const equityWithEarnings = equityTotal + netIncomeCents;
  const liabilitiesAndEquityTotal = liabilitiesTotal + equityWithEarnings;

  return {
    asOf,
    assets,
    assetsTotal,
    liabilities,
    liabilitiesTotal,
    equity,
    equityTotal: equityWithEarnings,
    netIncomeCents,
    liabilitiesAndEquityTotal,
    balanced: assetsTotal === liabilitiesAndEquityTotal,
  };
}

// ── Account ledger (drill-down) ─────────────────────────────────────────────

export type LedgerLine = {
  entryId: string;
  entryDate: Date;
  memo: string | null;
  lineMemo: string | null;
  debitCents: number;
  creditCents: number;
};

export async function accountLedger(code: string, from: Date, to: Date) {
  const [account] = await db.select().from(glAccounts).where(eq(glAccounts.code, code)).limit(1);
  if (!account) return null;

  const lines = await db
    .select({
      entryId: journalEntries.id,
      entryDate: journalEntries.entryDate,
      memo: journalEntries.memo,
      lineMemo: journalLines.memo,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(
      and(
        eq(journalLines.accountId, account.id),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
      ),
    )
    .orderBy(asc(journalEntries.entryDate));

  const totalDebit = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCredit = lines.reduce((s, l) => s + l.creditCents, 0);
  return { account, lines: lines as LedgerLine[], totalDebit, totalCredit };
}
