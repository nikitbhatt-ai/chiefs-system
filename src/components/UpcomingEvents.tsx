// Reusable "next 7 days" calendar snapshot, compact. Used on record detail
// pages (work order / deal / customer) to surface that record's upcoming
// events. NOTE: deliberately NOT wired into the dashboard yet (per the build
// brief) — it's ready to drop in when we decide to.

import Link from "next/link";
import { auth } from "@/auth";
import type { Role } from "@/lib/rbac";
import { fmtEventRange, eventTypeLabel } from "@/lib/calendar";
import { styleFor } from "@/components/calendar/types";
import { listUpcomingForRecord, listUpcomingForUser } from "@/lib/calendarQuery";

type Scope = { workOrderId?: string; dealId?: string; customerId?: string };

export async function UpcomingEvents({
  scope,
  heading = "Upcoming events",
  days = 7,
  limit = 5,
}: {
  scope?: Scope;
  heading?: string;
  days?: number;
  limit?: number;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const ctx = { userId: session.user.id, role: (session.user.role as Role) ?? null };
  const from = new Date();

  const events =
    scope && (scope.workOrderId || scope.dealId || scope.customerId)
      ? await listUpcomingForRecord(ctx, scope, { from, days, limit })
      : await listUpcomingForUser(ctx, { from, days, limit });

  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">{heading}</span>
        <Link href="/calendar" className="text-[10px] text-amber-400 hover:text-amber-300 font-body">Calendar →</Link>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-4 text-xs text-zinc-500">Nothing scheduled in the next {days} days.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {events.map((e) => {
            const s = styleFor(e.eventType);
            return (
              <li key={e.id}>
                <Link href={`/calendar?event=${e.id}`} className="flex items-start gap-2 px-4 py-2 hover:bg-white/5">
                  <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-white truncate">{e.title}</span>
                    <span className="block text-[11px] text-zinc-500">
                      {fmtEventRange(e.startsAt, e.endsAt, e.allDay)} · {eventTypeLabel(e.eventType)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
