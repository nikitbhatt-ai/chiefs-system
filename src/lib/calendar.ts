// Shared calendar helpers — event-type metadata, wall-clock time handling, and
// server-side permission rules. Imported by the API routes, the page, the
// client UI, and the reusable UpcomingEvents component so the rules live once.

import type { Role } from "@/lib/rbac";

// ── Event types ───────────────────────────────────────────────────────────────
// Value + human label. Colours/icons are a UI concern and live in the client
// component; labels are needed server-side too (notifications), so they live here.
export const CALENDAR_EVENT_TYPES = [
  { value: "service", label: "Service" },
  { value: "upfit", label: "Upfit" },
  { value: "offsite", label: "Offsite install" },
  { value: "delivery", label: "Delivery" },
  { value: "customer_meeting", label: "Customer meeting" },
  { value: "announcement", label: "Announcement" },
  { value: "other", label: "Other" },
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number]["value"];
export const CALENDAR_EVENT_TYPE_VALUES: readonly CalendarEventType[] =
  CALENDAR_EVENT_TYPES.map((t) => t.value);

export function eventTypeLabel(v: string): string {
  return CALENDAR_EVENT_TYPES.find((t) => t.value === v)?.label ?? v;
}

// ── Visibility + attendee response ────────────────────────────────────────────
export const VISIBILITY_VALUES = ["team", "selected"] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];

export const ATTENDEE_RESPONSES = ["invited", "accepted", "declined"] as const;
export type AttendeeResponse = (typeof ATTENDEE_RESPONSES)[number];

// The shop runs on America/Chicago. We surface this label in the UI so a time
// is never ambiguous about which clock it refers to.
export const SHOP_TZ_LABEL = "CT";

// ── Wall-clock time handling ──────────────────────────────────────────────────
// The DB uses plain `timestamp` (no zone), matching the rest of the schema.
// We treat every calendar time as a SHOP-LOCAL wall clock and store it in the
// UTC fields of the Date. Reading it back in UTC then reproduces the exact clock
// face the user picked, for every viewer, regardless of their browser's zone.
// (This avoids the classic "event drifts by 5 hours" bug without switching the
// column to timestamptz.)

const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a datetime-local string ("2026-07-27T14:00") as a shop wall clock. */
export function parseWallClock(local: string | null | undefined): Date | null {
  if (!local) return null;
  const m = LOCAL_DT_RE.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Parse a date-only string ("2026-07-27") as start- or end-of-day wall clock. */
export function parseWallClockDate(
  local: string | null | undefined,
  endOfDay = false,
): Date | null {
  if (!local) return null;
  const m = LOCAL_DATE_RE.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Date.UTC(+y, +mo - 1, +d, 23, 59, 0))
    : new Date(Date.UTC(+y, +mo - 1, +d, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Format a stored wall-clock Date, reading its UTC fields so it never drifts. */
export function fmtWallClock(
  d: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { ...opts, timeZone: "UTC" });
}

/** Short form for compact lists / notifications: "Jul 27" or "Jul 27, 2:00 PM". */
export function fmtEventDateShort(startsAt: Date | string, allDay: boolean): string {
  return allDay
    ? fmtWallClock(startsAt, { month: "short", day: "numeric" })
    : fmtWallClock(startsAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Full range for detail/agenda rows, e.g. "Jul 27, 2:00 – 4:00 PM CT". */
export function fmtEventRange(
  startsAt: Date | string,
  endsAt: Date | string,
  allDay: boolean,
): string {
  const s = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const e = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  const sameDay =
    s.getUTCFullYear() === e.getUTCFullYear() &&
    s.getUTCMonth() === e.getUTCMonth() &&
    s.getUTCDate() === e.getUTCDate();

  if (allDay) {
    const sd = fmtWallClock(s, { month: "short", day: "numeric" });
    if (sameDay) return `${sd} · All day`;
    const ed = fmtWallClock(e, { month: "short", day: "numeric" });
    return `${sd} – ${ed} · All day`;
  }

  const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (sameDay) {
    return `${fmtWallClock(s, dateOpts)}, ${fmtWallClock(s, timeOpts)} – ${fmtWallClock(e, timeOpts)} ${SHOP_TZ_LABEL}`;
  }
  return `${fmtWallClock(s, { ...dateOpts, ...timeOpts })} – ${fmtWallClock(e, { ...dateOpts, ...timeOpts })} ${SHOP_TZ_LABEL}`;
}

/** Date → "YYYY-MM-DDTHH:mm" (UTC fields) for a datetime-local input default. */
export function toLocalInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}T${p(date.getUTCHours())}:${p(date.getUTCMinutes())}`;
}

/** Date → "YYYY-MM-DD" (UTC fields) for a date input default. */
export function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
}

// Resolve start/end from a create/edit payload, honouring the all-day flag.
// Returns an error string when the times are missing or end-before-start.
export function resolveEventTimes(input: {
  allDay: boolean;
  startsAt: string;
  endsAt: string;
}): { startsAt: Date; endsAt: Date } | string {
  let startsAt: Date | null;
  let endsAt: Date | null;
  if (input.allDay) {
    startsAt = parseWallClockDate(input.startsAt, false) ?? parseWallClock(input.startsAt);
    endsAt = parseWallClockDate(input.endsAt || input.startsAt, true) ?? parseWallClock(input.endsAt);
  } else {
    startsAt = parseWallClock(input.startsAt);
    endsAt = parseWallClock(input.endsAt);
  }
  if (!startsAt || !endsAt) return "Start and end date/time are required.";
  if (endsAt.getTime() < startsAt.getTime()) return "Event cannot end before it starts.";
  return { startsAt, endsAt };
}

// ── Permissions (enforced server-side in every route and action) ──────────────
// There is no Postgres row-level security in this app — these rules must run in
// server code, never trusted to the client.

export type EventPerms = { createdBy: string; visibility: string };

/** Edit / cancel: creator, admin, or manager only. */
export function canManageEvent(
  role: Role | null | undefined,
  event: EventPerms,
  userId: string,
): boolean {
  return event.createdBy === userId || role === "admin" || role === "manager";
}

/**
 * Read: visibility 'team' → everyone; otherwise creator, an attendee, or an
 * admin/manager. `isAttendee` must be resolved from the attendee table by the
 * caller (the client is never trusted for it).
 */
export function canReadEvent(
  ctx: { role: Role | null | undefined; userId: string; isAttendee: boolean },
  event: EventPerms,
): boolean {
  if (event.visibility === "team") return true;
  if (event.createdBy === ctx.userId) return true;
  if (ctx.isAttendee) return true;
  return ctx.role === "admin" || ctx.role === "manager";
}
