// Time-clock service. All punches go through here so the rules live in one
// place: a user can have at most one open shift at a time, geolocation is
// validated against the shop geofence on clock-in, and labor rolls up per
// work order for build costing.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { timeEntries, workOrders } from "@/db/schema";
import { distanceMeters, withinGeofence, ENFORCE, RADIUS_METERS } from "@/config/shopLocation";
import {
  CLOCKED_SECONDS_SQL,
  laborCostCents,
  loadLaborRates,
  rateForUser,
} from "@/lib/laborRates";

export type Coords = { lat: number; lng: number };

export type ClockInResult =
  | { ok: true; entryId: string; withinGeofence: boolean; distanceMeters: number | null }
  | { ok: false; status: number; error: string; distanceMeters?: number; radiusMeters?: number };

// Open a shift. Rejects a second concurrent clock-in (the partial row lock on
// the user's open entry serializes double-clicks). When ENFORCE is on, an
// out-of-range position is rejected; otherwise it's recorded and flagged.
export async function clockIn(
  userId: string,
  workOrderId: string | null,
  coords: Coords | null,
): Promise<ClockInResult> {
  const dist = coords ? distanceMeters(coords.lat, coords.lng) : null;
  const inside = coords ? withinGeofence(coords.lat, coords.lng) : false;

  if (ENFORCE && (!coords || !inside)) {
    return {
      ok: false,
      status: 403,
      error: coords
        ? "You're outside the shop geofence — clock-in is only allowed on-site."
        : "Location is required to clock in.",
      distanceMeters: dist ?? undefined,
      radiusMeters: RADIUS_METERS,
    };
  }

  return db.transaction(async (tx) => {
    const [open] = await tx
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockedOutAt)))
      .for("update");
    if (open) {
      return { ok: false as const, status: 409, error: "You're already clocked in. Clock out first." };
    }
    const [row] = await tx
      .insert(timeEntries)
      .values({
        userId,
        workOrderId: workOrderId || null,
        clockInLat: coords ? String(coords.lat) : null,
        clockInLng: coords ? String(coords.lng) : null,
        clockInDistanceMeters: dist != null ? dist.toFixed(1) : null,
        clockInWithinGeofence: coords ? inside : null,
      })
      .returning({ id: timeEntries.id });
    return { ok: true as const, entryId: row.id, withinGeofence: inside, distanceMeters: dist };
  });
}

export type ClockOutResult =
  | { ok: true; entryId: string; minutes: number }
  | { ok: false; status: number; error: string };

// Close the caller's open shift. Geolocation on clock-out is optional and not
// geofenced — we don't want to trap a tech who walked to the parking lot.
export async function clockOut(userId: string, coords: Coords | null): Promise<ClockOutResult> {
  return db.transaction(async (tx) => {
    const [open] = await tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockedOutAt)))
      .orderBy(desc(timeEntries.clockedInAt))
      .for("update");
    if (!open) {
      return { ok: false as const, status: 409, error: "You're not clocked in." };
    }
    const now = new Date();
    await tx
      .update(timeEntries)
      .set({
        clockedOutAt: now,
        clockOutLat: coords ? String(coords.lat) : null,
        clockOutLng: coords ? String(coords.lng) : null,
      })
      .where(eq(timeEntries.id, open.id));
    const minutes = Math.max(0, Math.round((now.getTime() - open.clockedInAt.getTime()) / 60000));
    return { ok: true as const, entryId: open.id, minutes };
  });
}

// The caller's currently-open shift, if any.
export async function getOpenEntry(userId: string) {
  const [open] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockedOutAt)))
    .orderBy(desc(timeEntries.clockedInAt))
    .limit(1);
  return open ?? null;
}

// Per-work-order labor roll-up: clocked hours and labor cost per build, ordered
// by spend. Open shifts are excluded (no end time yet, so nothing to value).
//
// Cost is derived from the ACTUAL punches booked against each work order,
// valued per technician at that person's rate from `labor_rates` (their own
// override, else the shop default) — see src/lib/laborRates.ts. Grouping by
// technician as well as work order is what makes per-person rates meaningful;
// the previous version grouped by work order only and multiplied by one
// hardcoded shop rate, so a senior tech and an apprentice on the same build
// cost the same.
export type WorkOrderLabor = {
  workOrderId: string;
  woNumber: string | null;
  seconds: number;
  hours: number;
  costCents: number;
  /**
   * True when some of these hours had no rate to value them at, so `costCents`
   * understates the real cost. Surfaced in the UI rather than silently
   * reporting a too-low number.
   */
  missingRate: boolean;
};

/**
 * Roll up labor per build. Pass `workOrderId` to cost a single build instead of
 * loading every one — the work-order detail page needs exactly one, and scanning
 * the whole shop to display it was wasteful.
 */
export async function laborByWorkOrder(workOrderId?: string): Promise<WorkOrderLabor[]> {
  const filters = [
    sql`${timeEntries.workOrderId} IS NOT NULL`,
    sql`${timeEntries.clockedOutAt} IS NOT NULL`,
  ];
  if (workOrderId) filters.push(eq(timeEntries.workOrderId, workOrderId));

  const [rows, rates] = await Promise.all([
    db
      .select({
        workOrderId: timeEntries.workOrderId,
        userId: timeEntries.userId,
        woNumber: workOrders.woNumber,
        seconds: CLOCKED_SECONDS_SQL,
      })
      .from(timeEntries)
      .leftJoin(workOrders, eq(workOrders.id, timeEntries.workOrderId))
      .where(and(...filters))
      // Per technician per build, so each person's hours are costed at their rate.
      .groupBy(timeEntries.workOrderId, timeEntries.userId, workOrders.woNumber),
    loadLaborRates(),
  ]);

  const byWo = new Map<string, WorkOrderLabor>();
  for (const r of rows) {
    if (!r.workOrderId) continue;
    const seconds = Number(r.seconds) || 0;
    const hours = seconds / 3600;
    const { rateCents, source } = rateForUser(rates, r.userId);

    const cur =
      byWo.get(r.workOrderId) ??
      {
        workOrderId: r.workOrderId,
        woNumber: r.woNumber ?? null,
        seconds: 0,
        hours: 0,
        costCents: 0,
        missingRate: false,
      };
    cur.seconds += seconds;
    cur.hours += hours;
    // Round per technician, then sum — so the per-tech rows on a job add up to
    // the job's total exactly.
    cur.costCents += laborCostCents(hours, rateCents);
    if (source === "unset" && seconds > 0) cur.missingRate = true;
    byWo.set(r.workOrderId, cur);
  }

  return Array.from(byWo.values()).sort((a, b) => b.costCents - a.costCents);
}
