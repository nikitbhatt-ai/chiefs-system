// Lot vocabulary and the days-on-lot calculation.
//
// Deliberately free of any database import: the inline lot-status control is a
// client component, and anything it imports is bundled for the browser. Pulling
// `@/db` in here drags the Postgres driver into the client bundle and the build
// fails — which is exactly what happened before this split. The query lives in
// `@/lib/lotQuery`, which is server-only.
//
// Days-on-lot is the number the lot view exists for. We store partner vehicles
// that generate no revenue while they sit, and this is the figure that answers
// whether that is working. It is COMPUTED from the check-in event log, never
// stored — a stored copy would be wrong by morning — and it cannot be
// backfilled, which is why the check-in flow captures arrival time from day one.

export const LOT_STATUSES = [
  "on_lot_available",
  "on_lot_assigned",
  "in_shop",
  "departed",
] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const OWNERSHIPS = ["chiefs", "customer", "sames"] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  on_lot_available: "On lot — available",
  on_lot_assigned: "On lot — assigned",
  in_shop: "In shop",
  departed: "Departed",
};

export const OWNERSHIP_LABELS: Record<Ownership, string> = {
  chiefs: "Chiefs",
  customer: "Customer",
  sames: "Sames",
};

export type LotFilters = {
  ownership?: Ownership | "unset" | null;
  lotStatus?: LotStatus | null;
  deal?: "has" | "none" | null;
  q?: string | null;
  // The lot view is about what is HERE, so departed units are out unless asked
  // for. Selecting the "departed" status explicitly overrides this.
  includeDeparted?: boolean;
};


// Whole days since the vehicle arrived — or the length of the stay, once it has
// departed. Null when there is no check-in to measure from: a vehicle added
// through /vehicles rather than checked in has no arrival to count from, and
// showing "0 days" there would be a lie rather than a gap.
export function daysOnLot(
  arrivedAt: Date | null | undefined,
  departedAt: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!arrivedAt) return null;
  const end = departedAt ?? now;
  const ms = end.getTime() - arrivedAt.getTime();
  if (!Number.isFinite(ms)) return null;
  // A clock skew or a future-dated arrival should read as 0, not negative.
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// Last 8 of the VIN is what anyone on the lot actually reads off a windscreen.
export function shortVin(vin: string): string {
  return vin.length <= 8 ? vin : vin.slice(-8);
}
