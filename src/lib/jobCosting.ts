// Job costing — Phase 5.
//
// A job = a work order. Its cost has two parts:
//   • Materials — parts issued to the build, already posted to Work in Progress
//     (1300) tagged with work_order_id by the Phase 4 inventory hooks. We read
//     the WIP balance for the job straight off the ledger.
//   • Labor — hours from the existing `time_entries` valued at an hourly cost
//     rate (`labor_rates`: per-user, falling back to the shop default).
//
// Closing a job settles its WIP to COGS:  Dr COGS / Cr WIP (1300) for the job's
// current WIP balance. That zeroes the job out of WIP and lands the material cost
// in COGS. Labor is treated as a period expense via payroll (not double-booked
// here); it still shows in the rollup for management.
//
// The COGS debit is SPLIT across the component accounts (5110 Wire & Cable, 5120
// Emergency Lights, …) in proportion to the categories of the parts actually
// issued to the job — see src/lib/cogsCategories.ts. Material whose category has
// no mapping lands on 5100 Vehicle Parts — Uncategorized, which is also the
// single-line fallback for jobs with no issue detail to split by.

import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  workOrders,
  timeEntries,
  users,
  glAccounts,
  journalEntries,
  journalLines,
} from "@/db/schema";
import { postJournalEntry, reverseJournalEntry, LedgerError } from "@/lib/accounting";
import {
  CLOCKED_SECONDS_SQL,
  laborCostCents,
  loadLaborRates,
  rateForUser,
} from "@/lib/laborRates";
import { cogsSplitForWorkOrder, UNCATEGORIZED_COGS_CODE } from "@/lib/cogsCategories";

const WIP_CODE = "1300";

/** Accounts that receive material settled out of WIP. */
const SETTLED_COGS_FILTER = sql`${glAccounts.reportGroup} = 'cogs_parts'`;

// ── Labor rates ───────────────────────────────────────────────────────────────
// Rate resolution lives in src/lib/laborRates.ts so the time clock and these
// accounting screens cost the same hours identically. Re-exported here because
// /accounting/labor-rates has always imported them from this module.
export {
  defaultLaborRateCents,
  laborRateMap,
  setLaborRate,
} from "@/lib/laborRates";

// ── Cost rollup ─────────────────────────────────────────────────────────────

/** Posted WIP balance (debits − credits on account 1300) tagged to a work order, in cents. */
export async function wipBalanceForWorkOrder(workOrderId: string): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${journalLines.debitCents} - ${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(
      and(
        eq(journalLines.workOrderId, workOrderId),
        eq(journalEntries.status, "posted"),
        sql`${glAccounts.code} = ${WIP_CODE}`,
      ),
    );
  return row?.cents ?? 0;
}

export type LaborEntry = {
  userId: string | null;
  userName: string | null;
  hours: number;
  rateCents: number;
  /** Where `rateCents` came from — lets the UI flag hours nothing can value. */
  rateSource: "user" | "default" | "unset";
  costCents: number;
};

/** Labor lines for a work order: each tech's actual clocked hours × their rate.
 *  Only closed punches count (an open shift has no end time to value). */
export async function laborForWorkOrder(
  workOrderId: string,
): Promise<{ entries: LaborEntry[]; totalHours: number; totalCents: number; missingRate: boolean }> {
  const [rows, rates] = await Promise.all([
    db
      .select({
        userId: timeEntries.userId,
        userName: users.displayName,
        userNameFallback: users.name,
        seconds: CLOCKED_SECONDS_SQL,
      })
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.userId))
      .where(and(eq(timeEntries.workOrderId, workOrderId), sql`${timeEntries.clockedOutAt} IS NOT NULL`))
      .groupBy(timeEntries.userId, users.displayName, users.name),
    loadLaborRates(),
  ]);

  let totalHours = 0;
  let totalCents = 0;
  let missingRate = false;
  const entries: LaborEntry[] = rows.map((r) => {
    const hours = (Number(r.seconds) || 0) / 3600;
    const { rateCents, source } = rateForUser(rates, r.userId);
    const costCents = laborCostCents(hours, rateCents);
    totalHours += hours;
    totalCents += costCents;
    if (source === "unset" && hours > 0) missingRate = true;
    return {
      userId: r.userId,
      userName: r.userName ?? r.userNameFallback ?? null,
      hours,
      rateCents,
      rateSource: source,
      costCents,
    };
  });
  return { entries, totalHours, totalCents, missingRate };
}

export type JobCost = {
  workOrderId: string;
  woNumber: string | null;
  status: string;
  materialsCents: number; // COGS-settled material for the job (issued − returned − settled)
  wipBalanceCents: number; // material still sitting in WIP (unsettled)
  laborHours: number;
  laborCents: number;
  totalCents: number; // materials issued (wip + settled) + labor
  settled: boolean;
  /** Some clocked hours on this job had no cost rate, so laborCents is low. */
  missingRate: boolean;
};

/** Full cost rollup for a single work order. */
export async function jobCostRollup(workOrderId: string): Promise<JobCost | null> {
  const wo = await db.query.workOrders.findFirst({ where: eq(workOrders.id, workOrderId) });
  if (!wo) return null;

  const [wipBalanceCents, labor, settledCents] = await Promise.all([
    wipBalanceForWorkOrder(workOrderId),
    laborForWorkOrder(workOrderId),
    settledCogsForWorkOrder(workOrderId),
  ]);

  // Total material issued to the job = what's still in WIP plus what's been
  // settled to COGS. Labor is informational (period-expensed via payroll).
  const materialsCents = wipBalanceCents + settledCents;
  return {
    workOrderId,
    woNumber: wo.woNumber,
    status: wo.status,
    materialsCents,
    wipBalanceCents,
    laborHours: labor.totalHours,
    laborCents: labor.totalCents,
    missingRate: labor.missingRate,
    totalCents: materialsCents + labor.totalCents,
    settled: Boolean(wo.cogsJournalEntryId),
  };
}

/**
 * Material already moved to COGS for a job, in cents.
 *
 * Sums every `cogs_parts` account rather than just 5100, because the settlement
 * now splits across the component accounts. Keying this off 5100 alone would make
 * a split job look unsettled and double-count it as still-in-WIP material.
 */
async function settledCogsForWorkOrder(workOrderId: string): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${journalLines.debitCents} - ${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(
      and(
        eq(journalLines.workOrderId, workOrderId),
        eq(journalEntries.status, "posted"),
        SETTLED_COGS_FILTER,
      ),
    );
  return row?.cents ?? 0;
}

/**
 * Cost rollup across all work orders that have any WIP, COGS, or labor activity.
 * Set-based (four grouped queries merged in memory) so it scales past a handful
 * of jobs without an N+1.
 */
export async function listJobCosts(): Promise<JobCost[]> {
  const [wos, wipRows, cogsRows, laborRows, rates] = await Promise.all([
    db.select({ id: workOrders.id, woNumber: workOrders.woNumber, status: workOrders.status, cogsJournalEntryId: workOrders.cogsJournalEntryId }).from(workOrders),
    ledgerByWorkOrder(sql`${glAccounts.code} = ${WIP_CODE}`),
    ledgerByWorkOrder(SETTLED_COGS_FILTER),
    db
      .select({
        workOrderId: timeEntries.workOrderId,
        userId: timeEntries.userId,
        seconds: CLOCKED_SECONDS_SQL,
      })
      .from(timeEntries)
      .where(sql`${timeEntries.clockedOutAt} IS NOT NULL AND ${timeEntries.workOrderId} IS NOT NULL`)
      .groupBy(timeEntries.workOrderId, timeEntries.userId),
    loadLaborRates(),
  ]);

  const laborByWo = new Map<string, { hours: number; cents: number; missingRate: boolean }>();
  for (const r of laborRows) {
    if (!r.workOrderId) continue;
    const hours = (Number(r.seconds) || 0) / 3600;
    const { rateCents, source } = rateForUser(rates, r.userId);
    const cur = laborByWo.get(r.workOrderId) ?? { hours: 0, cents: 0, missingRate: false };
    cur.hours += hours;
    cur.cents += laborCostCents(hours, rateCents);
    if (source === "unset" && hours > 0) cur.missingRate = true;
    laborByWo.set(r.workOrderId, cur);
  }

  const out: JobCost[] = [];
  for (const wo of wos) {
    const wip = wipRows.get(wo.id) ?? 0;
    const settled = cogsRows.get(wo.id) ?? 0;
    const labor = laborByWo.get(wo.id) ?? { hours: 0, cents: 0, missingRate: false };
    const materialsCents = wip + settled;
    // Keyed off hours, not cost: a job with real clocked time but no rate to
    // value it at still belongs on this list. Testing cost alone made such a
    // job vanish entirely instead of showing up with a rate warning.
    if (materialsCents === 0 && labor.hours === 0) continue; // no activity at all — skip
    out.push({
      workOrderId: wo.id,
      woNumber: wo.woNumber,
      status: wo.status,
      materialsCents,
      wipBalanceCents: wip,
      laborHours: labor.hours,
      laborCents: labor.cents,
      totalCents: materialsCents + labor.cents,
      settled: Boolean(wo.cogsJournalEntryId),
      missingRate: labor.missingRate,
    });
  }
  out.sort((a, b) => b.totalCents - a.totalCents);
  return out;
}

/** Posted (debit − credit) by work_order_id for the accounts matching `filter`. */
async function ledgerByWorkOrder(filter: SQL): Promise<Map<string, number>> {
  const rows = await db
    .select({
      workOrderId: journalLines.workOrderId,
      cents: sql<number>`COALESCE(SUM(${journalLines.debitCents} - ${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.status, "posted"), filter))
    .groupBy(journalLines.workOrderId);
  const map = new Map<string, number>();
  for (const r of rows) if (r.workOrderId) map.set(r.workOrderId, r.cents);
  return map;
}

// ── Settle WIP → COGS ─────────────────────────────────────────────────────────

/**
 * Move a job's current WIP balance to COGS. Idempotent via
 * work_orders.cogs_journal_entry_id — a second call throws rather than
 * double-posting. Reverse with `reopenJob` if a job needs to go back into WIP.
 */
export async function settleJobToCogs(workOrderId: string, createdBy?: string | null) {
  const wo = await db.query.workOrders.findFirst({ where: eq(workOrders.id, workOrderId) });
  if (!wo) throw new LedgerError("Work order not found.");
  if (wo.cogsJournalEntryId) throw new LedgerError("This job has already been settled to COGS.");

  const wipCents = await wipBalanceForWorkOrder(workOrderId);
  if (wipCents <= 0) throw new LedgerError("Nothing in WIP to settle for this job.");

  const wipId = await accountId(WIP_CODE);
  const split = await cogsSplitForWorkOrder(db, workOrderId, wipCents);
  if (split.length === 0) {
    throw new LedgerError(
      `Chart of accounts is missing COGS account ${UNCATEGORIZED_COGS_CODE}. Run docs/sql/accounting_phase11.sql in Neon.`,
    );
  }

  const entry = await postJournalEntry({
    memo: `Job ${wo.woNumber ?? workOrderId} — WIP settled to COGS`,
    source: "system",
    createdBy: createdBy ?? null,
    lines: [
      ...split.map((s) => ({
        accountId: s.accountId,
        debitCents: s.cents,
        workOrderId,
        // Name the categories folded into the line so the ledger drill-down
        // explains why this account got this amount.
        memo: s.categories.length > 0 ? `${s.name} — ${s.categories.join(", ")}` : s.name,
      })),
      { accountId: wipId, creditCents: wipCents, workOrderId, memo: "Work in progress" },
    ],
  });

  await db.update(workOrders).set({ cogsJournalEntryId: entry.id, updatedAt: new Date() }).where(eq(workOrders.id, workOrderId));
  return entry;
}

/** Reverse a job's WIP→COGS settlement, putting the cost back into WIP. */
export async function reopenJob(workOrderId: string, createdBy?: string | null) {
  const wo = await db.query.workOrders.findFirst({ where: eq(workOrders.id, workOrderId) });
  if (!wo) throw new LedgerError("Work order not found.");
  if (!wo.cogsJournalEntryId) throw new LedgerError("This job is not settled.");

  await reverseJournalEntry(wo.cogsJournalEntryId, createdBy);
  await db.update(workOrders).set({ cogsJournalEntryId: null, updatedAt: new Date() }).where(eq(workOrders.id, workOrderId));
}

async function accountId(code: string): Promise<string> {
  const [row] = await db.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code)).limit(1);
  if (!row) throw new LedgerError(`Chart of accounts is missing account ${code}. Run docs/sql/accounting_phase1.sql in Neon.`);
  return row.id;
}
