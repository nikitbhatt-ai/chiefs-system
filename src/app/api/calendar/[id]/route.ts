import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { calendarEvents, calendarEventAttendees } from "@/db/schema";
import type { Role } from "@/lib/rbac";
import {
  CALENDAR_EVENT_TYPE_VALUES,
  VISIBILITY_VALUES,
  canManageEvent,
  resolveEventTimes,
} from "@/lib/calendar";
import { getEventForUser, activeAttendeeIds } from "@/lib/calendarQuery";
import { notifyCalendarEvent } from "@/lib/calendarNotify";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ctx = { userId: session.user.id, role: (session.user.role as Role) ?? null };
  const event = await getEventForUser(ctx, id);
  if (event === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (event === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(event);
}

// Edit or cancel. Creator / admin / manager only (enforced here, server-side).
// Cancel is a soft action (sets cancelled_at) — calendar events are never
// hard-deleted (see DELETE below).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const role = (session.user.role as Role) ?? null;
  const userId = session.user.id;

  const [existing] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!canManageEvent(role, existing, userId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ctx = { userId, role };

  // Attendees to notify (the current set), resolved once up front.
  const currentAttendees = await db
    .select({ userId: calendarEventAttendees.userId })
    .from(calendarEventAttendees)
    .where(eq(calendarEventAttendees.eventId, id));
  const currentIds = currentAttendees.map((a) => a.userId);

  // ── Cancel ──────────────────────────────────────────────────────────────
  if (body.cancel === true) {
    if (!existing.cancelledAt) {
      await db
        .update(calendarEvents)
        .set({ cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(calendarEvents.id, id));
      await notifyCalendarEvent({
        action: "cancelled",
        recipientIds: currentIds,
        actorId: userId,
        event: { id: existing.id, title: existing.title, startsAt: existing.startsAt, allDay: existing.allDay },
      });
    }
    const event = await getEventForUser(ctx, id);
    return NextResponse.json(event);
  }

  // ── Edit ────────────────────────────────────────────────────────────────
  const update: Partial<typeof calendarEvents.$inferInsert> = { updatedAt: new Date() };

  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: "Title is required." }, { status: 400 });
    update.title = t;
  }
  if ("description" in body) {
    update.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if ("location" in body) {
    update.location = typeof body.location === "string" ? body.location.trim() || null : null;
  }
  if ("eventType" in body) {
    const et = String(body.eventType ?? "");
    if (!CALENDAR_EVENT_TYPE_VALUES.includes(et as never)) {
      return NextResponse.json({ error: "Invalid event type." }, { status: 400 });
    }
    update.eventType = et as (typeof CALENDAR_EVENT_TYPE_VALUES)[number];
  }
  if ("visibility" in body) {
    const v = String(body.visibility ?? "");
    if (!VISIBILITY_VALUES.includes(v as never)) {
      return NextResponse.json({ error: "Invalid visibility." }, { status: 400 });
    }
    update.visibility = v;
  }
  if ("customerId" in body) update.customerId = typeof body.customerId === "string" && body.customerId ? body.customerId : null;
  if ("dealId" in body) update.dealId = typeof body.dealId === "string" && body.dealId ? body.dealId : null;
  if ("workOrderId" in body) update.workOrderId = typeof body.workOrderId === "string" && body.workOrderId ? body.workOrderId : null;

  // Times: only when the client sent them. Validate against the resulting pair.
  if ("startsAt" in body || "endsAt" in body || "allDay" in body) {
    const allDay = "allDay" in body ? body.allDay === true : existing.allDay;
    const startsAt = typeof body.startsAt === "string" ? body.startsAt : existing.startsAt.toISOString();
    const endsAt = typeof body.endsAt === "string" ? body.endsAt : existing.endsAt.toISOString();
    const times = resolveEventTimes({ allDay, startsAt, endsAt });
    if (typeof times === "string") return NextResponse.json({ error: times }, { status: 400 });
    update.allDay = allDay;
    update.startsAt = times.startsAt;
    update.endsAt = times.endsAt;
  }

  await db.update(calendarEvents).set(update).where(eq(calendarEvents.id, id));

  // Re-sync attendees only when the client sent an explicit list.
  let notifyIds = currentIds;
  if (Array.isArray(body.attendeeIds)) {
    const nextIds = await activeAttendeeIds(body.attendeeIds);
    const toRemove = currentIds.filter((uid) => !nextIds.includes(uid));
    const toAdd = nextIds.filter((uid) => !currentIds.includes(uid));
    if (toRemove.length > 0) {
      await db
        .delete(calendarEventAttendees)
        .where(and(eq(calendarEventAttendees.eventId, id), inArray(calendarEventAttendees.userId, toRemove)));
    }
    if (toAdd.length > 0) {
      await db
        .insert(calendarEventAttendees)
        .values(toAdd.map((uid) => ({ eventId: id, userId: uid })))
        .onConflictDoNothing();
    }
    notifyIds = nextIds;
  }

  await notifyCalendarEvent({
    action: "updated",
    recipientIds: notifyIds,
    actorId: userId,
    event: {
      id: existing.id,
      title: (update.title as string | undefined) ?? existing.title,
      startsAt: (update.startsAt as Date | undefined) ?? existing.startsAt,
      allDay: (update.allDay as boolean | undefined) ?? existing.allDay,
    },
  });

  const event = await getEventForUser(ctx, id);
  return NextResponse.json(event);
}

// Calendar events are cancelled, never deleted (PATCH { cancel: true }), so the
// history stays intact. Reject hard deletes explicitly.
export async function DELETE() {
  return NextResponse.json(
    { error: "Calendar events are cancelled, not deleted. Use PATCH { cancel: true }." },
    { status: 405 },
  );
}
