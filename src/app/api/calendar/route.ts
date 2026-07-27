import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { calendarEvents, calendarEventAttendees } from "@/db/schema";
import type { Role } from "@/lib/rbac";
import {
  CALENDAR_EVENT_TYPE_VALUES,
  VISIBILITY_VALUES,
  resolveEventTimes,
} from "@/lib/calendar";
import { listEventsForUser, getEventForUser, activeAttendeeIds } from "@/lib/calendarQuery";
import { notifyCalendarEvent } from "@/lib/calendarNotify";

export const dynamic = "force-dynamic";

function parseRange(url: URL): { from: Date; to: Date } {
  const now = new Date();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam && !Number.isNaN(Date.parse(fromParam))
    ? new Date(fromParam)
    : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const to = toParam && !Number.isNaN(Date.parse(toParam))
    ? new Date(toParam)
    : new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ctx = { userId: session.user.id, role: (session.user.role as Role) ?? null };
  const range = parseRange(new URL(req.url));
  const events = await listEventsForUser(ctx, range);
  return NextResponse.json(events);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Create is deliberately open to any authenticated user — anyone can flag
  // something to the team.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const eventType = String(body.eventType ?? "");
  if (!CALENDAR_EVENT_TYPE_VALUES.includes(eventType as never)) {
    return NextResponse.json({ error: "Invalid event type." }, { status: 400 });
  }

  const visibility = String(body.visibility ?? "team");
  if (!VISIBILITY_VALUES.includes(visibility as never)) {
    return NextResponse.json({ error: "Invalid visibility." }, { status: 400 });
  }

  const times = resolveEventTimes({
    allDay: body.allDay === true,
    startsAt: typeof body.startsAt === "string" ? body.startsAt : "",
    endsAt: typeof body.endsAt === "string" ? body.endsAt : "",
  });
  if (typeof times === "string") return NextResponse.json({ error: times }, { status: 400 });

  const attendeeIds = await activeAttendeeIds(body.attendeeIds);

  const [event] = await db
    .insert(calendarEvents)
    .values({
      title,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      eventType: eventType as (typeof CALENDAR_EVENT_TYPE_VALUES)[number],
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      allDay: body.allDay === true,
      location: typeof body.location === "string" ? body.location.trim() || null : null,
      customerId: typeof body.customerId === "string" && body.customerId ? body.customerId : null,
      dealId: typeof body.dealId === "string" && body.dealId ? body.dealId : null,
      workOrderId: typeof body.workOrderId === "string" && body.workOrderId ? body.workOrderId : null,
      visibility,
      createdBy: session.user.id,
    })
    .returning();

  if (attendeeIds.length > 0) {
    await db
      .insert(calendarEventAttendees)
      .values(attendeeIds.map((userId) => ({ eventId: event.id, userId })))
      .onConflictDoNothing();
    await notifyCalendarEvent({
      action: "invited",
      recipientIds: attendeeIds,
      actorId: session.user.id,
      event: { id: event.id, title: event.title, startsAt: event.startsAt, allDay: event.allDay },
    });
  }

  const ctx = { userId: session.user.id, role: (session.user.role as Role) ?? null };
  const serialized = await getEventForUser(ctx, event.id);
  return NextResponse.json(serialized, { status: 201 });
}
