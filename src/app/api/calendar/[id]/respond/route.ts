import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { calendarEventAttendees } from "@/db/schema";
import { ATTENDEE_RESPONSES } from "@/lib/calendar";

export const dynamic = "force-dynamic";

// An attendee sets their OWN response (accepted / declined / invited). No one
// can change anyone else's — the update is scoped to (event, this user).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const response = String(body.response ?? "");
  if (!ATTENDEE_RESPONSES.includes(response as never)) {
    return NextResponse.json({ error: "Invalid response." }, { status: 400 });
  }

  const [row] = await db
    .update(calendarEventAttendees)
    .set({ response })
    .where(
      and(
        eq(calendarEventAttendees.eventId, id),
        eq(calendarEventAttendees.userId, session.user.id),
      ),
    )
    .returning({ id: calendarEventAttendees.id });

  // Only invitees may respond — if there's no attendee row, this user wasn't invited.
  if (!row) return NextResponse.json({ error: "You are not on the invite list for this event." }, { status: 403 });
  return NextResponse.json({ ok: true, response });
}
