// Single choke point for every calendar notification.
//
// Today this writes to the in-app `notifications` table, so calendar activity
// surfaces in the bell (AppShell) and the /notifications list — reusing the
// existing system rather than building a second one.
//
// Email and SMS are deliberately NOT wired here yet. The dispatcher fans out in
// exactly one place (below), so enabling another channel later is a localized
// change: implement its `send` and flip its flag. See the Phase 1 summary for
// the full build-out (SMS needs a paid provider + a phone number on `users`,
// which does not exist today; email needs EMAIL_SERVER_* configured — the same
// env NextAuth already uses in src/auth.ts — plus an explicit owner opt-in,
// since the original brief deferred calendar email).

import { notifyMany } from "@/lib/notifications";
import { fmtEventDateShort } from "@/lib/calendar";

export type CalendarNoticeAction = "invited" | "updated" | "cancelled";

type NoticeEvent = {
  id: string;
  title: string;
  startsAt: Date | string;
  allDay: boolean;
};

// Channel switches. In-app is always on. The others stay off until the owner
// green-lights them — the send paths are stubbed under the marker below.
const CHANNELS = { inApp: true, email: false, sms: false } as const;

function buildMessage(action: CalendarNoticeAction, event: NoticeEvent) {
  const when = fmtEventDateShort(event.startsAt, event.allDay);
  const title = `Calendar: ${event.title}`;
  const verb =
    action === "invited"
      ? "You were invited to"
      : action === "updated"
        ? "Updated:"
        : "Cancelled:";
  const body = `${verb} “${event.title}” (${when}).`;
  const link = `/calendar?event=${event.id}`;
  return { title, body, link };
}

/**
 * Notify the given users about a calendar event. The actor (whoever performed
 * the action) is always removed from the recipient set, and duplicates/blanks
 * are dropped. No-ops when there is no one left to notify.
 */
export async function notifyCalendarEvent(opts: {
  action: CalendarNoticeAction;
  recipientIds: string[];
  actorId: string | null;
  event: NoticeEvent;
}): Promise<void> {
  const recipients = Array.from(new Set(opts.recipientIds.filter(Boolean))).filter(
    (id) => id !== opts.actorId,
  );
  if (recipients.length === 0) return;

  const { title, body, link } = buildMessage(opts.action, opts.event);

  if (CHANNELS.inApp) {
    await notifyMany(recipients, {
      kind: "calendar_event",
      title,
      body,
      link,
      actorId: opts.actorId,
    });
  }

  // ── Additional channels plug in HERE (one place) ──────────────────────────
  // if (CHANNELS.email) await sendCalendarEmail(recipients, { title, body, link });
  // if (CHANNELS.sms)   await sendCalendarSms(recipients, { title });
}
