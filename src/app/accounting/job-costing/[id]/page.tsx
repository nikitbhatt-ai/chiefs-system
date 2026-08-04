import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { workOrders } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { jobCostRollup, laborForWorkOrder, settleJobToCogs, reopenJob } from "@/lib/jobCosting";

export const dynamic = "force-dynamic";

export default async function JobCostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const wo = await db.query.workOrders.findFirst({ where: eq(workOrders.id, id) });
  if (!wo) notFound();

  const [rollup, labor] = await Promise.all([jobCostRollup(id), laborForWorkOrder(id)]);
  if (!rollup) notFound();

  async function settle() {
    "use server";
    const session = await auth();
    await settleJobToCogs(id, session?.user?.id ?? null);
    revalidatePath(`/accounting/job-costing/${id}`);
    revalidatePath("/accounting/job-costing");
  }

  async function reopen() {
    "use server";
    const session = await auth();
    await reopenJob(id, session?.user?.id ?? null);
    revalidatePath(`/accounting/job-costing/${id}`);
    revalidatePath("/accounting/job-costing");
  }

  return (
    <AppShell title={`Job ${wo.woNumber ?? id.slice(0, 8)}`} subtitle="Cost rollup — materials + labor">
      <div className="flex items-center gap-3">
        <Link href="/accounting/job-costing" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Job costing</Link>
        <Link href={`/work-orders`} className="text-xs text-amber-400 hover:text-amber-300 font-body">Work orders →</Link>
        {rollup.settled ? (
          <span className="text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 text-emerald-400 bg-emerald-500/10">settled to COGS</span>
        ) : (
          <span className="text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 text-zinc-400 bg-white/5">open in WIP</span>
        )}
      </div>

      {rollup.missingRate && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-body text-amber-200">
          <span className="font-semibold">Labor cost is understated.</span> Some clocked hours on this job
          have no hourly cost rate, so they are valued at $0.{" "}
          <Link href="/accounting/labor-rates" className="underline hover:text-amber-100">
            Set a shop default or per-tech rate
          </Link>{" "}
          and this recomputes.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Materials", value: fmtCents(rollup.materialsCents) },
          { label: "Labor", value: `${fmtCents(rollup.laborCents)} · ${rollup.laborHours.toFixed(1)}h` },
          { label: "Total cost", value: fmtCents(rollup.totalCents), strong: true },
          { label: "In WIP (unsettled)", value: fmtCents(rollup.wipBalanceCents) },
        ].map((c) => (
          <div key={c.label} className="bg-surface border border-white/5 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">{c.label}</div>
            <div className={`font-mono mt-1 ${c.strong ? "text-white font-semibold text-lg font-display" : "text-white"}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          Labor by tech ({labor.entries.length})
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2">Tech</th>
              <th className="px-4 py-2 text-right">Hours</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {labor.entries.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-500">No clocked labor on this job yet.</td></tr>
            ) : (
              labor.entries.map((e, i) => (
                <tr key={e.userId ?? i} className="border-t border-white/5">
                  <td className="px-4 py-2 text-xs text-white">{e.userName ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{e.hours.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">
                    {e.rateSource === "unset" ? (
                      <span className="text-amber-400">not set</span>
                    ) : (
                      <>
                        {fmtCents(e.rateCents)}/h
                        {e.rateSource === "default" ? <span className="text-zinc-600"> (default)</span> : null}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{fmtCents(e.costCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        {!rollup.settled && rollup.wipBalanceCents > 0 && (
          <form action={settle}>
            <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">
              Settle {fmtCents(rollup.wipBalanceCents)} WIP → COGS
            </button>
          </form>
        )}
        {rollup.settled && (
          <form action={reopen}>
            <button type="submit" className="text-xs font-body text-zinc-400 hover:text-amber-300 bg-white/5 border border-white/10 rounded-md px-4 py-2 transition-colors">
              Reopen job (reverse COGS)
            </button>
          </form>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Settling posts Dr Cost of Goods Sold / Cr Work in Progress for the amount still in WIP, moving this job&apos;s
        material cost out of inventory and into COGS. Labor is expensed through payroll and shown here for the full job
        cost picture, not posted again.
      </p>
    </AppShell>
  );
}
