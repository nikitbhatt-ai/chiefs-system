// Server-side calendar reads. Loads events with their attendees, resolves the
// linked-record labels, applies the visibility permission rule in SQL, and
// serializes to a stable shape the client and UpcomingEvents both consume.
// (Dates are emitted as ISO strings; their UTC fields carry the shop wall clock
// — see src/lib/calendar.ts.)

import { and, asc, eq, exists, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  calendarEvents,
  calendarEventAttendees,
  users,
  customers,
  deals,
  workOrders,
} from "@/db/schema";
import type { Role } from "@/lib/rbac";
import { canManageEvent } from "@/lib/calendar";

export type Ctx = { userId: string; role: Role | null };

export type SerializedAttendee = { userId: string; name: string | null; response: string };

export type SerializedEvent = {
  id: string;
  title: string;
  description: string | null;
  eventType: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  visibility: string;
  cancelledAt: string | null;
  createdBy: string;
  createdByName: string | null;
  customerId: string | null;
  customerName: string | null;
  dealId: string | null;
  dealLabel: string | null;
  workOrderId: string | null;
  woNumber: string | null;
  attendees: SerializedAttendee[];
  myResponse: string | null;
  canManage: boolean;
  createdAt: string;
};

type Row = {
  e: typeof calendarEvents.$inferSelect;
  createdByName: string | null;
  customerName: string | null;
  dealYear: number | null;
  dealMake: string | null;
  dealModel: string | null;
  woNumber: string | null;
};

const SELECTION = {
  e: calendarEvents,
  createdByName: sql<string | null>`coalesce(${users.displayName}, ${users.name})`,
  customerName: customers.name,
  dealYear: deals.vehicleYear,
  dealMake: deals.vehicleMake,
  dealModel: deals.vehicleModel,
  woNumber: workOrders.woNumber,
};

function baseQuery() {
  return db
    .select(SELECTION)
    .from(calendarEvents)
    .leftJoin(users, eq(users.id, calendarEvents.createdBy))
    .leftJoin(customers, eq(customers.id, calendarEvents.customerId))
    .leftJoin(deals, eq(deals.id, calendarEvents.dealId))
    .leftJoin(workOrders, eq(workOrders.id, calendarEvents.workOrderId));
}

// Visibility rule as SQL. Managers/admins see everything; everyone else sees
// team events, their own, or ones they're invited to.
function readableWhere(ctx: Ctx) {
  if (ctx.role === "admin" || ctx.role === "manager") return undefined;
  return or(
    eq(calendarEvents.visibility, "team"),
    eq(calendarEvents.createdBy, ctx.userId),
    exists(
      db
        .select({ one: sql`1` })
        .from(calendarEventAttendees)
        .where(
          and(
            eq(calendarEventAttendees.eventId, calendarEvents.id),
            eq(calendarEventAttendees.userId, ctx.userId),
          ),
        ),
    ),
  );
}

function dealLabelOf(row: Row): string {
  const parts = [row.dealYear, row.dealMake, row.dealModel].filter(Boolean);
  return parts.length ? parts.join(" ") : "Deal";
}

async function attendeesByEvent(eventIds: string[]): Promise<Map<string, SerializedAttendee[]>> {
  const map = new Map<string, SerializedAttendee[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select({
      eventId: calendarEventAttendees.eventId,
      userId: calendarEventAttendees.userId,
      response: calendarEventAttendees.response,
      name: sql<string | null>`coalesce(${users.displayName}, ${users.name})`,
    })
    .from(calendarEventAttendees)
    .leftJoin(users, eq(users.id, calendarEventAttendees.userId))
    .where(inArray(calendarEventAttendees.eventId, eventIds));
  for (const r of rows) {
    const list = map.get(r.eventId) ?? [];
    list.push({ userId: r.userId, name: r.name, response: r.response });
    map.set(r.eventId, list);
  }
  return map;
}

function serialize(row: Row, attendees: SerializedAttendee[], ctx: Ctx): SerializedEvent {
  const e = row.e;
  const mine = attendees.find((a) => a.userId === ctx.userId);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    eventType: e.eventType,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    allDay: e.allDay,
    location: e.location,
    visibility: e.visibility,
    cancelledAt: e.cancelledAt ? e.cancelledAt.toISOString() : null,
    createdBy: e.createdBy,
    createdByName: row.createdByName,
    customerId: e.customerId,
    customerName: row.customerName,
    dealId: e.dealId,
    dealLabel: e.dealId ? dealLabelOf(row) : null,
    workOrderId: e.workOrderId,
    woNumber: row.woNumber,
    attendees,
    myResponse: mine?.response ?? null,
    canManage: canManageEvent(ctx.role, e, ctx.userId),
    createdAt: e.createdAt.toISOString(),
  };
}

/** Events overlapping [from, to), readable by the user, ascending by start. */
export async function listEventsForUser(
  ctx: Ctx,
  range: { from: Date; to: Date },
): Promise<SerializedEvent[]> {
  const rows = (await baseQuery()
    .where(
      and(
        lt(calendarEvents.startsAt, range.to),
        gte(calendarEvents.endsAt, range.from),
        readableWhere(ctx),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))) as Row[];

  const attMap = await attendeesByEvent(rows.map((r) => r.e.id));
  return rows.map((r) => serialize(r, attMap.get(r.e.id) ?? [], ctx));
}

/** Events linked to one record (work order / deal / customer), next `days` days. */
export async function listUpcomingForRecord(
  ctx: Ctx,
  scope: { workOrderId?: string; dealId?: string; customerId?: string },
  opts: { from: Date; days: number; limit?: number },
): Promise<SerializedEvent[]> {
  const to = new Date(opts.from.getTime() + opts.days * 24 * 60 * 60 * 1000);
  const scopeCond = scope.workOrderId
    ? eq(calendarEvents.workOrderId, scope.workOrderId)
    : scope.dealId
      ? eq(calendarEvents.dealId, scope.dealId)
      : scope.customerId
        ? eq(calendarEvents.customerId, scope.customerId)
        : undefined;
  if (!scopeCond) return [];

  const rows = (await baseQuery()
    .where(
      and(
        scopeCond,
        gte(calendarEvents.endsAt, opts.from),
        lt(calendarEvents.startsAt, to),
        sql`${calendarEvents.cancelledAt} IS NULL`,
        readableWhere(ctx),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(opts.limit ?? 5)) as Row[];

  const attMap = await attendeesByEvent(rows.map((r) => r.e.id));
  return rows.map((r) => serialize(r, attMap.get(r.e.id) ?? [], ctx));
}

/** Keep only ids that belong to active users — never trust the client's list. */
export async function activeAttendeeIds(ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const wanted = Array.from(new Set(ids.filter((x): x is string => typeof x === "string")));
  if (wanted.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, wanted), eq(users.active, true)));
  return rows.map((r) => r.id);
}

/** Upcoming, non-cancelled events readable by the user (for UpcomingEvents). */
export async function listUpcomingForUser(
  ctx: Ctx,
  opts: { from: Date; days: number; limit?: number },
): Promise<SerializedEvent[]> {
  const to = new Date(opts.from.getTime() + opts.days * 24 * 60 * 60 * 1000);
  const rows = (await baseQuery()
    .where(
      and(
        gte(calendarEvents.endsAt, opts.from),
        lt(calendarEvents.startsAt, to),
        sql`${calendarEvents.cancelledAt} IS NULL`,
        readableWhere(ctx),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(opts.limit ?? 5)) as Row[];

  const attMap = await attendeesByEvent(rows.map((r) => r.e.id));
  return rows.map((r) => serialize(r, attMap.get(r.e.id) ?? [], ctx));
}

/** A single event. Returns null if missing, "forbidden" if not readable. */
export async function getEventForUser(
  ctx: Ctx,
  id: string,
): Promise<SerializedEvent | null | "forbidden"> {
  const [row] = (await baseQuery().where(eq(calendarEvents.id, id))) as Row[];
  if (!row) return null;
  const attendees = (await attendeesByEvent([id])).get(id) ?? [];
  const isAttendee = attendees.some((a) => a.userId === ctx.userId);
  const e = row.e;
  const readable =
    e.visibility === "team" ||
    e.createdBy === ctx.userId ||
    isAttendee ||
    ctx.role === "admin" ||
    ctx.role === "manager";
  if (!readable) return "forbidden";
  return serialize(row, attendees, ctx);
}
