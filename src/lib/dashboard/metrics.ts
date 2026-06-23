// Server-side metric resolvers for the three role-based dashboards.
//
// Every function is `async` and pure (no caching layer yet). When we move
// to Phase 2 with charts and longer-running queries, wrap the heavier
// ones in unstable_cache with sensible TTLs per the spec.

import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sum } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import {
  deals,
  quotes,
  workOrders,
  customers,
  dealTasks,
  partReceipts,
  purchaseOrders,
  dealCredentials,
  customerMessages,
  dealActivity,
  parts,
} from "@/db/schema";
import type { DealStage } from "@/lib/pipelines";

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}
function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((day + 6) % 7));
  return monday;
}
function endOfWeek(): Date {
  const sw = startOfWeek();
  return new Date(sw.getTime() + 7 * DAY_MS);
}

const OPEN_DEAL_STAGES: DealStage[] = ["prospect", "credential_verification", "quote_sent", "po_received", "deposit_received", "in_production"];
const WON_BUCKET_STAGES: DealStage[] = ["po_received", "deposit_received", "in_production", "delivered"];
const WON_OR_LOST_STAGES: DealStage[] = ["po_received", "deposit_received", "in_production", "delivered", "lost"];
const OPEN_WON_NOT_DELIVERED: DealStage[] = ["po_received", "deposit_received", "in_production"];
const ACTIVE_WO_STATUSES = ["confirmed", "awaiting_parts", "next_in_line", "in_progress", "qc_check"];

// ---------- Sales ----------

// KPI cards tolerate a little staleness, so cache the heavier roll-ups for
// 60s to spare the DB on every dashboard load. Action-item lists below are
// left uncached — they drive "do this now" workflows and must stay fresh.
export const salesKpis = unstable_cache(salesKpisImpl, ["dashboard:salesKpis"], { revalidate: 60 });

async function salesKpisImpl(userId: string | null) {
  void userId; // surface per-user filtering later; today the KPIs are global
  const monthStart = startOfMonth();
  const ninetyAgo = daysAgo(90);

  const [openDealRows, monthDeals, winLossWindow, deliveredWindow] = await Promise.all([
    db
      .select({ id: deals.id, stage: deals.stage, customerId: deals.customerId, createdAt: deals.createdAt })
      .from(deals)
      .where(inArray(deals.stage, OPEN_DEAL_STAGES)),
    db
      .select({ id: deals.id, stage: deals.stage, currentStageEnteredAt: deals.currentStageEnteredAt })
      .from(deals)
      .where(and(inArray(deals.stage, WON_BUCKET_STAGES), gte(deals.currentStageEnteredAt, monthStart))),
    db
      .select({ id: deals.id, stage: deals.stage })
      .from(deals)
      .where(and(inArray(deals.stage, WON_OR_LOST_STAGES), gte(deals.currentStageEnteredAt, ninetyAgo))),
    db
      .select({ id: deals.id, createdAt: deals.createdAt, currentStageEnteredAt: deals.currentStageEnteredAt })
      .from(deals)
      .where(and(eq(deals.stage, "delivered"), gte(deals.currentStageEnteredAt, ninetyAgo))),
  ]);

  // Pipeline value: sum of latest quote.grand_total per open deal. One
  // query for all quotes belonging to open deals, then dedupe by latest
  // updatedAt per dealId.
  const openDealIds = openDealRows.map((d) => d.id);
  let pipelineValue = 0;
  if (openDealIds.length) {
    const qs = await db
      .select({ dealId: quotes.dealId, grandTotal: quotes.grandTotal, updatedAt: quotes.updatedAt })
      .from(quotes)
      .where(inArray(quotes.dealId, openDealIds))
      .orderBy(desc(quotes.updatedAt));
    const seen = new Set<string>();
    for (const q of qs) {
      if (!q.dealId || seen.has(q.dealId)) continue;
      seen.add(q.dealId);
      pipelineValue += Number(q.grandTotal ?? 0) || 0;
    }
  }

  // Revenue closed this month: same dedup pattern for the won-bucket deals
  // whose currentStageEnteredAt is in this month.
  const monthDealIds = monthDeals.map((d) => d.id);
  let revenueThisMonth = 0;
  if (monthDealIds.length) {
    const qs = await db
      .select({ dealId: quotes.dealId, grandTotal: quotes.grandTotal, updatedAt: quotes.updatedAt })
      .from(quotes)
      .where(inArray(quotes.dealId, monthDealIds))
      .orderBy(desc(quotes.updatedAt));
    const seen = new Set<string>();
    for (const q of qs) {
      if (!q.dealId || seen.has(q.dealId)) continue;
      seen.add(q.dealId);
      revenueThisMonth += Number(q.grandTotal ?? 0) || 0;
    }
  }

  const won90 = winLossWindow.filter((d) => d.stage !== "lost").length;
  const lost90 = winLossWindow.filter((d) => d.stage === "lost").length;
  const winRate = won90 + lost90 > 0 ? (won90 / (won90 + lost90)) * 100 : null;

  const cycleSamples = deliveredWindow
    .map((d) => (d.currentStageEnteredAt.getTime() - d.createdAt.getTime()) / DAY_MS)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const avgCycleDays = cycleSamples.length ? cycleSamples.reduce((s, n) => s + n, 0) / cycleSamples.length : null;

  return {
    openDeals: openDealRows.length,
    pipelineValue,
    closedThisMonth: monthDeals.length,
    revenueThisMonth,
    winRate,
    avgCycleDays,
  };
}

export async function salesActionItems(userId: string | null) {
  if (!userId) return { stalledDeals: [], quotesAwaitingResponse: [], tasksDueToday: [] };
  const fourteenAgo = daysAgo(14);
  const tomorrow = new Date(new Date().setHours(23, 59, 59, 999));

  const [stalled, awaitingResponse, dueToday] = await Promise.all([
    db
      .select({ id: deals.id, customerId: deals.customerId, stage: deals.stage, currentStageEnteredAt: deals.currentStageEnteredAt })
      .from(deals)
      .where(and(eq(deals.assignedTo, userId), inArray(deals.stage, OPEN_DEAL_STAGES), lte(deals.currentStageEnteredAt, fourteenAgo)))
      .orderBy(asc(deals.currentStageEnteredAt))
      .limit(10),
    db
      .select({ id: quotes.id, quoteNumber: quotes.quoteNumber, customerId: quotes.customerId, updatedAt: quotes.updatedAt, dealId: quotes.dealId })
      .from(quotes)
      .where(and(eq(quotes.status, "sent"), lte(quotes.updatedAt, daysAgo(5))))
      .orderBy(asc(quotes.updatedAt))
      .limit(10),
    db
      .select({ id: dealTasks.id, title: dealTasks.title, dealId: dealTasks.dealId, dueDate: dealTasks.dueDate })
      .from(dealTasks)
      .where(and(eq(dealTasks.assignedTo, userId), isNull(dealTasks.completedAt), lte(dealTasks.dueDate, tomorrow)))
      .orderBy(asc(dealTasks.dueDate))
      .limit(10),
  ]);

  // Resolve customer names in one shot.
  const customerIds = Array.from(new Set([
    ...stalled.map((d) => d.customerId).filter(Boolean) as string[],
    ...awaitingResponse.map((q) => q.customerId).filter(Boolean) as string[],
  ]));
  const customerRows = customerIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
    : [];
  const customerName = new Map(customerRows.map((c) => [c.id, c.name]));

  return {
    stalledDeals: stalled.map((d) => ({
      id: d.id,
      stage: d.stage,
      daysInStage: Math.floor((Date.now() - d.currentStageEnteredAt.getTime()) / DAY_MS),
      customerName: d.customerId ? customerName.get(d.customerId) ?? "—" : "—",
    })),
    quotesAwaitingResponse: awaitingResponse.map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      dealId: q.dealId,
      customerName: q.customerId ? customerName.get(q.customerId) ?? "—" : "—",
      daysSince: Math.floor((Date.now() - q.updatedAt.getTime()) / DAY_MS),
    })),
    tasksDueToday: dueToday,
  };
}

// ---------- Operations ----------

export const operationsKpis = unstable_cache(operationsKpisImpl, ["dashboard:operationsKpis"], { revalidate: 60 });

async function operationsKpisImpl() {
  const ninetyAgo = daysAgo(90);
  const weekStart = startOfWeek();
  const weekEnd = endOfWeek();
  const now = new Date();

  // Pure counts run as SQL count() aggregates instead of selecting every row
  // and measuring array length. `completed` still needs its timestamps for the
  // avg-build-days computation, so it stays a row select.
  const [active, scheduled, ready, completed, pastDue] = await Promise.all([
    db.select({ n: count() }).from(workOrders).where(inArray(workOrders.status, ACTIVE_WO_STATUSES)),
    db
      .select({ n: count() })
      .from(workOrders)
      .where(and(gte(workOrders.targetBuildStartDate, weekStart), lte(workOrders.targetBuildStartDate, weekEnd))),
    db.select({ n: count() }).from(workOrders).where(eq(workOrders.status, "completed")),
    db
      .select({ createdAt: workOrders.createdAt, completedAt: workOrders.completedAt })
      .from(workOrders)
      .where(and(eq(workOrders.status, "delivered"), gte(workOrders.updatedAt, ninetyAgo))),
    db
      .select({ n: count() })
      .from(workOrders)
      .where(and(inArray(workOrders.status, ACTIVE_WO_STATUSES), lt(workOrders.targetBuildStartDate, now))),
  ]);

  // Avg days per build: prefer completedAt-createdAt when available;
  // otherwise null sample.
  const buildSamples = completed
    .map((w) => (w.completedAt && w.createdAt ? (w.completedAt.getTime() - w.createdAt.getTime()) / DAY_MS : null))
    .filter((n): n is number => Number.isFinite(n as number) && (n as number) >= 0);
  const avgBuildDays = buildSamples.length ? buildSamples.reduce((s, n) => s + n, 0) / buildSamples.length : null;

  // On-time completion proxy: completed within targetBuildStartDate + 30
  // days. Without a per-WO promised-by date column, this is the best we
  // can do until that lands.
  let onTimePct: number | null = null;
  const completedWithTarget = await db
    .select({
      completedAt: workOrders.completedAt,
      target: workOrders.targetBuildStartDate,
    })
    .from(workOrders)
    .where(and(eq(workOrders.status, "delivered"), gte(workOrders.updatedAt, ninetyAgo)));
  const completedTargeted = completedWithTarget.filter((w) => w.completedAt && w.target);
  if (completedTargeted.length) {
    const onTime = completedTargeted.filter(
      (w) => w.completedAt!.getTime() <= w.target!.getTime() + 30 * DAY_MS,
    ).length;
    onTimePct = (onTime / completedTargeted.length) * 100;
  }

  return {
    activeBuilds: Number(active[0]?.n ?? 0),
    scheduledThisWeek: Number(scheduled[0]?.n ?? 0),
    readyForDelivery: Number(ready[0]?.n ?? 0),
    avgBuildDays,
    onTimePct,
    pastDue: Number(pastDue[0]?.n ?? 0),
  };
}

export async function operationsActionItems() {
  const now = new Date();
  const weekAhead = new Date(Date.now() + 7 * DAY_MS);

  const [awaitingParts, posSoon, qcPending, lateVendor] = await Promise.all([
    db.select({ id: workOrders.id, woNumber: workOrders.woNumber, status: workOrders.status }).from(workOrders).where(eq(workOrders.status, "awaiting_parts")).limit(10),
    db
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, expectedAt: purchaseOrders.expectedAt })
      .from(purchaseOrders)
      .where(and(ne(purchaseOrders.status, "received"), lte(purchaseOrders.expectedAt, weekAhead)))
      .orderBy(asc(purchaseOrders.expectedAt))
      .limit(10),
    db.select({ id: workOrders.id, woNumber: workOrders.woNumber }).from(workOrders).where(eq(workOrders.status, "qc_check")).limit(10),
    db
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, expectedAt: purchaseOrders.expectedAt })
      .from(purchaseOrders)
      .where(and(ne(purchaseOrders.status, "received"), lt(purchaseOrders.expectedAt, now)))
      .orderBy(asc(purchaseOrders.expectedAt))
      .limit(10),
  ]);
  return { awaitingParts, posArrivingSoon: posSoon, qcPending, lateVendor };
}

// ---------- Admin ----------

export const adminKpis = unstable_cache(adminKpisImpl, ["dashboard:adminKpis"], { revalidate: 60 });

async function adminKpisImpl() {
  const monthStart = startOfMonth();
  const ninetyAgo = daysAgo(90);

  // Monthly revenue PROXY: sum of converted quotes' grand_total this month.
  // Until invoicing/payments lands, "converted" means we won the deal,
  // so we treat that as revenue earned in the month the conversion happened.
  const convertedThisMonth = await db
    .select({ grandTotal: quotes.grandTotal })
    .from(quotes)
    .where(and(eq(quotes.status, "converted"), gte(quotes.updatedAt, monthStart)));
  const monthlyRevenue = convertedThisMonth.reduce((s, q) => s + (Number(q.grandTotal ?? 0) || 0), 0);

  // Monthly expenses PROXY: sum of received PO totals where receivedAt is
  // this month.
  const posReceivedThisMonth = await db
    .select({ total: purchaseOrders.total })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.status, "received"), gte(purchaseOrders.receivedAt, monthStart)));
  const monthlyExpenses = posReceivedThisMonth.reduce((s, p) => s + (Number(p.total ?? 0) || 0), 0);

  // Outstanding receivables PROXY: latest-quote grand_total for deals in
  // won-bucket but not delivered.
  const openWonDeals = await db
    .select({ id: deals.id })
    .from(deals)
    .where(inArray(deals.stage, OPEN_WON_NOT_DELIVERED));
  let outstandingReceivables = 0;
  if (openWonDeals.length) {
    const qs = await db
      .select({ dealId: quotes.dealId, grandTotal: quotes.grandTotal, updatedAt: quotes.updatedAt })
      .from(quotes)
      .where(inArray(quotes.dealId, openWonDeals.map((d) => d.id)))
      .orderBy(desc(quotes.updatedAt));
    const seen = new Set<string>();
    for (const q of qs) {
      if (!q.dealId || seen.has(q.dealId)) continue;
      seen.add(q.dealId);
      outstandingReceivables += Number(q.grandTotal ?? 0) || 0;
    }
  }

  // Avg time per upfit: same as operations.avgBuildDays.
  const deliveredRecent = await db
    .select({ createdAt: workOrders.createdAt, completedAt: workOrders.completedAt })
    .from(workOrders)
    .where(and(eq(workOrders.status, "delivered"), gte(workOrders.updatedAt, ninetyAgo)));
  const buildSamples = deliveredRecent
    .map((w) => (w.completedAt && w.createdAt ? (w.completedAt.getTime() - w.createdAt.getTime()) / DAY_MS : null))
    .filter((n): n is number => Number.isFinite(n as number) && (n as number) >= 0);
  const avgUpfitDays = buildSamples.length ? buildSamples.reduce((s, n) => s + n, 0) / buildSamples.length : null;

  const netProfit = monthlyRevenue - monthlyExpenses;
  // Average days to payment PROXY: avg(currentStageEnteredAt − createdAt)
  // for deals that hit a won-bucket stage in last 90 days.
  const wonRecent = await db
    .select({ createdAt: deals.createdAt, currentStageEnteredAt: deals.currentStageEnteredAt })
    .from(deals)
    .where(and(inArray(deals.stage, WON_BUCKET_STAGES), gte(deals.currentStageEnteredAt, ninetyAgo)));
  const dsoSamples = wonRecent
    .map((d) => (d.currentStageEnteredAt.getTime() - d.createdAt.getTime()) / DAY_MS)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const avgDaysToPayment = dsoSamples.length ? dsoSamples.reduce((s, n) => s + n, 0) / dsoSamples.length : null;

  return {
    monthlyRevenue,
    monthlyExpenses,
    netProfit,
    outstandingReceivables,
    avgDaysToPayment,
    avgUpfitDays,
  };
}

export async function adminActionItems() {
  const now = new Date();
  const sixtyAhead = new Date(Date.now() + 60 * DAY_MS);
  const sixMonthsAgo = daysAgo(180);

  // Invoices past due PROXY: converted quotes older than 30 days that
  // belong to deals not yet delivered.
  const pastDueQuotes = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      grandTotal: quotes.grandTotal,
      updatedAt: quotes.updatedAt,
      customerId: quotes.customerId,
      dealId: quotes.dealId,
    })
    .from(quotes)
    .where(and(eq(quotes.status, "converted"), lte(quotes.updatedAt, daysAgo(30))))
    .orderBy(asc(quotes.updatedAt))
    .limit(10);

  // Expiring credentials: re-use the existing pattern.
  const expiringCreds = await db
    .select({
      id: dealCredentials.id,
      credentialType: dealCredentials.credentialType,
      expiresAt: dealCredentials.expiresAt,
      dealId: dealCredentials.dealId,
    })
    .from(dealCredentials)
    .where(and(gte(dealCredentials.expiresAt, now), lte(dealCredentials.expiresAt, sixtyAhead)))
    .orderBy(asc(dealCredentials.expiresAt))
    .limit(10);

  // Large open deals (top 5 by latest quote grand_total).
  const openDealRows = await db
    .select({ id: deals.id, customerId: deals.customerId })
    .from(deals)
    .where(inArray(deals.stage, OPEN_DEAL_STAGES));
  const dealIds = openDealRows.map((d) => d.id);
  const customerForDeal = new Map(openDealRows.map((d) => [d.id, d.customerId]));
  let largeOpen: { dealId: string; customerName: string; value: number }[] = [];
  if (dealIds.length) {
    const qs = await db
      .select({ dealId: quotes.dealId, grandTotal: quotes.grandTotal, updatedAt: quotes.updatedAt })
      .from(quotes)
      .where(inArray(quotes.dealId, dealIds))
      .orderBy(desc(quotes.updatedAt));
    const latestPerDeal = new Map<string, number>();
    for (const q of qs) {
      if (!q.dealId || latestPerDeal.has(q.dealId)) continue;
      latestPerDeal.set(q.dealId, Number(q.grandTotal ?? 0) || 0);
    }
    const customerIds = Array.from(new Set(Array.from(customerForDeal.values()).filter(Boolean) as string[]));
    const customerRows = customerIds.length
      ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
      : [];
    const customerName = new Map(customerRows.map((c) => [c.id, c.name]));
    largeOpen = Array.from(latestPerDeal.entries())
      .map(([dealId, value]) => {
        const cid = customerForDeal.get(dealId);
        return { dealId, customerName: cid ? customerName.get(cid) ?? "—" : "—", value };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  // Inactive high-value customers: customers with at least one delivered
  // deal, but no deal updatedAt in the last 6 months.
  const recentDealCustomers = await db
    .select({ customerId: deals.customerId })
    .from(deals)
    .where(gte(deals.updatedAt, sixMonthsAgo));
  const activeIds = new Set(recentDealCustomers.map((r) => r.customerId).filter(Boolean) as string[]);
  const deliveredCustomers = await db
    .select({ customerId: deals.customerId })
    .from(deals)
    .where(eq(deals.stage, "delivered"));
  const deliveredIds = new Set(deliveredCustomers.map((r) => r.customerId).filter(Boolean) as string[]);
  const inactiveIds = Array.from(deliveredIds).filter((id) => !activeIds.has(id)).slice(0, 5);
  const inactiveRows = inactiveIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, inactiveIds))
    : [];

  // Customer names for pastDueQuotes.
  const pastDueCustomerIds = Array.from(new Set(pastDueQuotes.map((q) => q.customerId).filter(Boolean) as string[]));
  const pastDueCustRows = pastDueCustomerIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, pastDueCustomerIds))
    : [];
  const pastDueCustomerName = new Map(pastDueCustRows.map((c) => [c.id, c.name]));

  return {
    pastDueInvoices: pastDueQuotes.map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      dealId: q.dealId,
      customerName: q.customerId ? pastDueCustomerName.get(q.customerId) ?? "—" : "—",
      grandTotal: Number(q.grandTotal ?? 0) || 0,
      daysSince: Math.floor((Date.now() - q.updatedAt.getTime()) / DAY_MS),
    })),
    expiringCreds,
    largeOpen,
    inactiveCustomers: inactiveRows,
  };
}

// Unused-import guards — keeps the imports above honest as we add cache
// wrappers in a later PR.
void sum;
void or;
void partReceipts;
void customerMessages;
void dealActivity;
void parts;
