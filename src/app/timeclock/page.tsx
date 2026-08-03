import { and, desc, eq, inArray, isNull, not } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { timeEntries, workOrders, customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";
import { getOpenEntry, laborByWorkOrder } from "@/lib/timeclock";
import { fmtCents } from "@/lib/accounting";
import { TimeClockPanel } from "./TimeClockPanel";

export const dynamic = "force-dynamic";

function durationLabel(inAt: Date, outAt: Date | null): string {
  const end = outAt ?? new Date();
  const mins = Math.max(0, Math.round((end.getTime() - inAt.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export default async function TimeClockPage() {
  const session = await auth();
  if (!session?.user) return null;
  const userId = session.user.id;

  // Active builds for the clock-in dropdown (anything not delivered/archived).
  const woRows = await db
    .select({ id: workOrders.id, woNumber: workOrders.woNumber, customerId: workOrders.customerId, status: workOrders.status })
    .from(workOrders)
    .where(and(not(eq(workOrders.status, "delivered")), not(eq(workOrders.status, "archived"))))
    .orderBy(desc(workOrders.createdAt));
  const custIds = Array.from(new Set(woRows.map((w) => w.customerId).filter(Boolean) as string[]));
  const custRows = custIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, custIds))
    : [];
  const custMap = new Map(custRows.map((c) => [c.id, c.name]));
  const woLabel = (w: { id: string; woNumber: string | null; customerId: string | null }) =>
    `${w.woNumber ?? w.id.slice(0, 8)}${w.customerId && custMap.get(w.customerId) ? ` · ${custMap.get(w.customerId)}` : ""}`;
  const woOptions = woRows.map((w) => ({ id: w.id, label: woLabel(w) }));
  const woLabelById = new Map(woRows.map((w) => [w.id, woLabel(w)]));

  const openRaw = await getOpenEntry(userId);
  const open = openRaw
    ? {
        id: openRaw.id,
        clockInAt: openRaw.clockedInAt.toISOString(),
        woLabel: openRaw.workOrderId ? woLabelById.get(openRaw.workOrderId) ?? null : null,
      }
    : null;

  // This user's recent punches.
  const recent = await db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.userId, userId))
    .orderBy(desc(timeEntries.clockedInAt))
    .limit(15);

  const labor = await laborByWorkOrder();

  return (
    <AppShell title="Time Clock" subtitle="Geo-verified clock-in · labor tracked per build">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <TimeClockPanel open={open} workOrders={woOptions} />

          <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
            <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-body border-b border-white/5">
              Your recent punches
            </div>
            <table className="w-full text-sm">
              <tbody className="font-body text-zinc-200">
                {recent.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-xs text-zinc-500">No punches yet.</td>
                  </tr>
                ) : (
                  recent.map((e) => (
                    <tr key={e.id} className="border-t border-white/5">
                      <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(e.clockedInAt)}</td>
                      <td className="px-3 py-2 text-xs">
                        {e.workOrderId ? woLabelById.get(e.workOrderId) ?? "build" : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {e.clockedOutAt ? (
                          <span className="text-zinc-300">{durationLabel(e.clockedInAt, e.clockedOutAt)}</span>
                        ) : (
                          <span className="text-green-400">open</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {e.clockInWithinGeofence === false ? (
                          <span className="text-[10px] uppercase rounded border px-1.5 py-0.5 bg-amber-500/10 text-amber-300 border-amber-500/30">
                            off-site
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden h-fit">
          <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-body border-b border-white/5">
            Labor per build (closed shifts)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
                <th className="px-3 py-2">Work order</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Labor $</th>
              </tr>
            </thead>
            <tbody className="font-body text-zinc-200">
              {labor.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-zinc-500">
                    No closed shifts attached to a build yet.
                  </td>
                </tr>
              ) : (
                labor.map((l) => (
                  <tr key={l.workOrderId} className="border-t border-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-white">{l.woNumber ?? l.workOrderId.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-xs text-right">{l.hours.toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs text-right text-amber-300">
                      {fmtCents(l.costCents)}
                      {l.missingRate ? (
                        <span className="ml-1 text-amber-500" title="Some hours have no cost rate set — see Accounting → Labor rates">
                          *
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {labor.some((l) => l.missingRate) && (
            <p className="px-4 py-2.5 text-[11px] text-amber-300/80 font-body border-t border-white/5">
              <span className="text-amber-400">*</span> Some clocked hours have no hourly cost rate, so that
              build&apos;s labor cost is understated. An admin can set rates under Accounting → Labor rates.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
