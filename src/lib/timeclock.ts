// Time-clock service. All punches go through here so the rules live in one
// place: a user can have at most one open shift at a time, geolocation is
// validated against the shop geofence on clock-in, and labor rolls up per
// work order for build costing.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { timeClockEntries, workOrders } from "@/db/schema";
import { distanceMeters, withinGeofence, ENFORCE, RADIUS_METERS } from "@/config/shopLocation";
import { DEFAULT_LABOR_RATE_USD_PER_HOUR } from "@/config/labor";

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
      .select({ id: timeClockEntries.id })
      .from(timeClockEntries)
      .where(and(eq(timeClockEntries.userId, userId), isNull(timeClockEntries.clockOutAt)))
      .for("update");
    if (open) {
      return { ok: false as const, status: 409, error: "You're already clocked in. Clock out first." };
    }
    const [row] = await tx
      .insert(timeClockEntries)
      .values({
        userId,
        workOrderId: workOrderId || null,
        clockInLat: coords ? String(coords.lat) : null,
        clockInLng: coords ? String(coords.lng) : null,
        clockInDistanceMeters: dist != null ? dist.toFixed(1) : null,
        clockInWithinGeofence: coords ? inside : null,
      })
      .returning({ id: timeClockEntries.id });
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
      .from(timeClockEntries)
      .where(and(eq(timeClockEntries.userId, userId), isNull(timeClockEntries.clockOutAt)))
      .orderBy(desc(timeClockEntries.clockInAt))
      .for("update");
    if (!open) {
      return { ok: false as const, status: 409, error: "You're not clocked in." };
    }
    const now = new Date();
    await tx
      .update(timeClockEntries)
      .set({
        clockOutAt: now,
        clockOutLat: coords ? String(coords.lat) : null,
        clockOutLng: coords ? String(coords.lng) : null,
      })
      .where(eq(timeClockEntries.id, open.id));
    const minutes = Math.max(0, Math.round((now.getTime() - open.clockInAt.getTime()) / 60000));
    return { ok: true as const, entryId: open.id, minutes };
  });
}

// The caller's currently-open shift, if any.
export async function getOpenEntry(userId: string) {
  const [open] = await db
    .select()
    .from(timeClockEntries)
    .where(and(eq(timeClockEntries.userId, userId), isNull(timeClockEntries.clockOutAt)))
    .orderBy(desc(timeClockEntries.clockInAt))
    .limit(1);
  return open ?? null;
}

// Per-work-order labor roll-up: total clocked hours and labor $ for closed
// shifts, ordered by spend. Open shifts are excluded (no end time yet).
export type WorkOrderLabor = {
  workOrderId: string;
  woNumber: string | null;
  minutes: number;
  hours: number;
  laborCost: number;
};

export async function laborByWorkOrder(): Promise<WorkOrderLabor[]> {
  const rows = await db
    .select({
      workOrderId: timeClockEntries.workOrderId,
      woNumber: workOrders.woNumber,
      minutes: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${timeClockEntries.clockOutAt} - ${timeClockEntries.clockInAt})) / 60), 0)`,
    })
    .from(timeClockEntries)
    .leftJoin(workOrders, eq(workOrders.id, timeClockEntries.workOrderId))
    .where(sql`${timeClockEntries.workOrderId} IS NOT NULL AND ${timeClockEntries.clockOutAt} IS NOT NULL`)
    .groupBy(timeClockEntries.workOrderId, workOrders.woNumber);

  return rows
    .map((r) => {
      const minutes = Math.round(Number(r.minutes) || 0);
      const hours = minutes / 60;
      return {
        workOrderId: r.workOrderId as string,
        woNumber: r.woNumber ?? null,
        minutes,
        hours: Math.round(hours * 100) / 100,
        laborCost: Math.round(hours * DEFAULT_LABOR_RATE_USD_PER_HOUR * 100) / 100,
      };
    })
    .sort((a, b) => b.laborCost - a.laborCost);
}
