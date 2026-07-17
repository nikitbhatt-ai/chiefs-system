// Job costing — Phase 5.
//
// A job = a work order. Its cost has two parts:
//   • Materials — parts issued to the build, already posted to Work in Progress
//     (1300) tagged with work_order_id by the Phase 4 inventory hooks. We read
//     the WIP balance for the job straight off the ledger.
//   • Labor — hours from the existing `time_entries` valued at an hourly cost
//     rate (`labor_rates`: per-user, falling back to the shop default).
//
// Closing a job settles its WIP to COGS:  Dr COGS (5100) / Cr WIP (1300) for the
// job's current WIP balance. That zeroes the job out of WIP and lands the
// material cost in COGS. Labor is treated as a period expense via payroll (not
// double-booked here); it still shows in the rollup for management.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  workOrders,
  timeEntries,
  users,
  laborRates,
  glAccounts,
  journalEntries,
  journalLines,
} from "@/db/schema";
import { postJournalEntry, reverseJournalEntry, LedgerError } from "@/lib/accounting";

const WIP_CODE = "1300";
const COGS_CODE = "5100";

// ── Labor rates ───────────────────────────────────────────────────────────────

/** Shop-wide default hourly cost rate in cents (0 if unset). */
export async function defaultLaborRateCents(): Promise<number> {
  const [row] = await db.select({ rateCents: laborRates.rateCents }).from(laborRates).where(isNull(laborRates.userId)).limit(1);
  return row?.rateCents ?? 0;
}

/** Map of userId → rate cents (per-user overrides only; excludes the default). */
export async function laborRateMap(): Promise<Map<string, number>> {
  const rows = await db.select({ userId: laborRates.userId, rateCents: laborRates.rateCents }).from(laborRates);
  const map = new Map<string, number>();
  for (const r of rows) if (r.userId) map.set(r.userId, r.rateCents);
  return map;
}

/** Upsert a rate. userId null sets the shop default. */
export async function setLaborRate(userId: string | null, rateCents: number) {
  const cents = Math.max(0, Math.round(rateCents));
  const existing = userId
    ? await db.select({ id: laborRates.id }).from(laborRates).where(eq(laborRates.userId, userId)).limit(1)
    : await db.select({ id: laborRates.id }).from(laborRates).where(isNull(laborRates.userId)).limit(1);
  if (existing.length) {
    await db.update(laborRates).set({ rateCents: cents, updatedAt: new Date() }).where(eq(laborRates.id, existing[0].id));
  } else {
    await db.insert(laborRates).values({ userId, rateCents: cents });
  }
}

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
  costCents: number;
};

/** Labor lines for a work order: hours per tech × their rate. Only closed punches count. */
export async function laborForWorkOrder(workOrderId: string): Promise<{ entries: LaborEntry[]; totalHours: number; totalCents: number }> {
  const rows = await db
    .select({
      userId: timeEntries.userId,
      userName: users.displayName,
      userNameFallback: users.name,
      hours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${timeEntries.clockedOutAt} - ${timeEntries.clockedInAt})) / 3600.0), 0)`.mapWith(Number),
    })
    .from(timeEntries)
    .leftJoin(users, eq(users.id, timeEntries.userId))
    .where(and(eq(timeEntries.workOrderId, workOrderId), sql`${timeEntries.clockedOutAt} IS NOT NULL`))
    .groupBy(timeEntries.userId, users.displayName, users.name);

  const [rateMap, defaultRate] = await Promise.all([laborRateMap(), defaultLaborRateCents()]);

  let totalHours = 0;
  let totalCents = 0;
  const entries: LaborEntry[] = rows.map((r) => {
    const rateCents = (r.userId && rateMap.get(r.userId)) || defaultRate;
    const costCents = Math.round(r.hours * rateCents);
    totalHours += r.hours;
    totalCents += costCents;
    return { userId: r.userId, userName: r.userName ?? r.userNameFallback ?? null, hours: r.hours, rateCents, costCents };
  });
  return { entries, totalHours, totalCents };
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
    totalCents: materialsCents + labor.totalCents,
    settled: Boolean(wo.cogsJournalEntryId),
  };
}

/** Material already moved to COGS for a job (debits on 5100 tagged to the WO), in cents. */
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
        sql`${glAccounts.code} = ${COGS_CODE}`,
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
  const [wos, wipRows, cogsRows, laborRows, rateMap, defaultRate] = await Promise.all([
    db.select({ id: workOrders.id, woNumber: workOrders.woNumber, status: workOrders.status, cogsJournalEntryId: workOrders.cogsJournalEntryId }).from(workOrders),
    ledgerByWorkOrder(WIP_CODE),
    ledgerByWorkOrder(COGS_CODE),
    db
      .select({
        workOrderId: timeEntries.workOrderId,
        userId: timeEntries.userId,
        hours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${timeEntries.clockedOutAt} - ${timeEntries.clockedInAt})) / 3600.0), 0)`.mapWith(Number),
      })
      .from(timeEntries)
      .where(sql`${timeEntries.clockedOutAt} IS NOT NULL AND ${timeEntries.workOrderId} IS NOT NULL`)
      .groupBy(timeEntries.workOrderId, timeEntries.userId),
    laborRateMap(),
    defaultLaborRateCents(),
  ]);

  const laborByWo = new Map<string, { hours: number; cents: number }>();
  for (const r of laborRows) {
    if (!r.workOrderId) continue;
    const rate = (r.userId && rateMap.get(r.userId)) || defaultRate;
    const cur = laborByWo.get(r.workOrderId) ?? { hours: 0, cents: 0 };
    cur.hours += r.hours;
    cur.cents += Math.round(r.hours * rate);
    laborByWo.set(r.workOrderId, cur);
  }

  const out: JobCost[] = [];
  for (const wo of wos) {
    const wip = wipRows.get(wo.id) ?? 0;
    const settled = cogsRows.get(wo.id) ?? 0;
    const labor = laborByWo.get(wo.id) ?? { hours: 0, cents: 0 };
    const materialsCents = wip + settled;
    if (materialsCents === 0 && labor.cents === 0) continue; // no accounting activity — skip
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
    });
  }
  out.sort((a, b) => b.totalCents - a.totalCents);
  return out;
}

/** Posted (debit − credit) by work_order_id for a given account code. */
async function ledgerByWorkOrder(code: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      workOrderId: journalLines.workOrderId,
      cents: sql<number>`COALESCE(SUM(${journalLines.debitCents} - ${journalLines.creditCents}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.status, "posted"), sql`${glAccounts.code} = ${code}`))
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

  const [wipId, cogsId] = await Promise.all([accountId(WIP_CODE), accountId(COGS_CODE)]);

  const entry = await postJournalEntry({
    memo: `Job ${wo.woNumber ?? workOrderId} — WIP settled to COGS`,
    source: "system",
    createdBy: createdBy ?? null,
    lines: [
      { accountId: cogsId, debitCents: wipCents, workOrderId, memo: "Cost of goods sold" },
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
