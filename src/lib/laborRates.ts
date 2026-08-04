// Single source of truth for hourly labor COST rates.
//
// Rates live in the `labor_rates` table: one row per user (an override) plus an
// optional shop-wide default row (user_id NULL), editable at
// /accounting/labor-rates. Nothing is hardcoded.
//
// Why this module exists: a hardcoded `DEFAULT_LABOR_RATE_USD_PER_HOUR = 95`
// used to live in src/config/labor.ts and was read by the time clock, while the
// accounting job-costing screens read the `labor_rates` table. The two
// disagreed — the same clocked hours on the same build produced one labor cost
// on /work-orders/[id] and a different one on /accounting/job-costing, and if
// the table's default row was never seeded the accounting side silently reported
// $0. That constant is gone; every labor cost in the app now resolves through
// here, so all screens agree by construction.
//
// These are COST rates — what a build costs us. What we BILL a customer for
// labor is entered per quote line in the quote editor and is deliberately
// unrelated to these; never use one for the other or job margins go wrong.

import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { laborRates } from "@/db/schema";

/**
 * Clocked duration of closed punches, in seconds. Shared by every labor query so
 * the hours behind each screen's cost figure are computed identically — summing
 * seconds and dividing once avoids the drift you get from rounding to minutes
 * first in one place and hours in another.
 */
export const CLOCKED_SECONDS_SQL = sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (time_entries.clocked_out_at - time_entries.clocked_in_at))), 0)`;

export type ResolvedRates = {
  /** userId → rate in cents (per-user overrides only). */
  byUser: Map<string, number>;
  /** Shop-wide default rate in cents; 0 when no default row exists. */
  defaultCents: number;
  /** Whether a shop-wide default row exists at all. */
  hasDefault: boolean;
};

/**
 * Load every rate in one query. Callers resolve per user via `rateForUser`.
 *
 * Phase 5's `UNIQUE (user_id)` index does not constrain the shop-default row,
 * because Postgres treats NULLs as distinct — so a database can legitimately
 * hold more than one default. Rows are ordered oldest-first and the default is
 * overwritten as we go, which lands on the most-recently-updated one: the rate
 * whoever last hit Save intended. Without the ordering the winner would be
 * whatever Postgres returned first, so the same books could value a job
 * differently between two page loads.
 */
export async function loadLaborRates(): Promise<ResolvedRates> {
  const rows = await db
    .select({ userId: laborRates.userId, rateCents: laborRates.rateCents })
    .from(laborRates)
    .orderBy(asc(laborRates.updatedAt), asc(laborRates.createdAt));

  const byUser = new Map<string, number>();
  let defaultCents = 0;
  let hasDefault = false;
  for (const r of rows) {
    if (r.userId) byUser.set(r.userId, r.rateCents);
    else {
      defaultCents = r.rateCents;
      hasDefault = true;
    }
  }
  return { byUser, defaultCents, hasDefault };
}

export type RateSource = "user" | "default" | "unset";

/**
 * Resolve the cost rate for one person: their own override, else the shop
 * default, else unset.
 *
 * A rate of 0 is treated as "not filled in" rather than "this person is free",
 * so it falls through to the next level — matching how the rate table has
 * always behaved. "unset" is reported rather than silently costing hours at
 * $0, so the UI can tell the user their rates need configuring instead of
 * quietly understating every job.
 */
export function rateForUser(
  rates: ResolvedRates,
  userId: string | null,
): { rateCents: number; source: RateSource } {
  if (userId) {
    const own = rates.byUser.get(userId);
    if (own != null && own > 0) return { rateCents: own, source: "user" };
  }
  if (rates.defaultCents > 0) return { rateCents: rates.defaultCents, source: "default" };
  return { rateCents: 0, source: "unset" };
}

/**
 * Cost of `hours` at `rateCents`/hour, rounded to the nearest cent.
 * Always rounded per person per job, never on a grand total, so the per-tech
 * rows on a job add up to that job's labor total exactly.
 */
export function laborCostCents(hours: number, rateCents: number): number {
  return Math.round(hours * rateCents);
}

/** Blended effective rate (cents/hour) implied by a cost and its hours. */
export function blendedRateCents(costCents: number, hours: number): number {
  if (hours <= 0) return 0;
  return Math.round(costCents / hours);
}

// ── Admin write path (used by /accounting/labor-rates) ───────────────────────

/** Shop-wide default hourly cost rate in cents (0 if unset). Picks the
 *  most-recently-updated default, matching `loadLaborRates`, so the admin
 *  screen and the costing screens never disagree about which one is live. */
export async function defaultLaborRateCents(): Promise<number> {
  const [row] = await db
    .select({ rateCents: laborRates.rateCents })
    .from(laborRates)
    .where(isNull(laborRates.userId))
    .orderBy(desc(laborRates.updatedAt), desc(laborRates.createdAt))
    .limit(1);
  return row?.rateCents ?? 0;
}

/** Map of userId → rate cents (per-user overrides only; excludes the default). */
export async function laborRateMap(): Promise<Map<string, number>> {
  const { byUser } = await loadLaborRates();
  return byUser;
}

/** Upsert a rate. `userId` null sets the shop default. */
export async function setLaborRate(userId: string | null, rateCents: number) {
  const cents = Math.max(0, Math.round(rateCents));
  // Same ordering as the read path, so Save updates the row the costing
  // screens are actually reading when a database holds more than one default.
  const existing = userId
    ? await db.select({ id: laborRates.id }).from(laborRates).where(eq(laborRates.userId, userId)).limit(1)
    : await db
        .select({ id: laborRates.id })
        .from(laborRates)
        .where(isNull(laborRates.userId))
        .orderBy(desc(laborRates.updatedAt), desc(laborRates.createdAt))
        .limit(1);
  if (existing.length) {
    await db
      .update(laborRates)
      .set({ rateCents: cents, updatedAt: new Date() })
      .where(eq(laborRates.id, existing[0].id));
  } else {
    await db.insert(laborRates).values({ userId, rateCents: cents });
  }
}
