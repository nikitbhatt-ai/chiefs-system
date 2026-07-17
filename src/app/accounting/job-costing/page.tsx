import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { listJobCosts } from "@/lib/jobCosting";

export const dynamic = "force-dynamic";

export default async function JobCostingPage() {
  const jobs = await listJobCosts();

  const totalWip = jobs.reduce((s, j) => s + j.wipBalanceCents, 0);
  const openJobs = jobs.filter((j) => j.wipBalanceCents > 0).length;

  return (
    <AppShell title="Job costing" subtitle="Materials (from WIP) + labor per work order; settle WIP to COGS on close">
      <div className="flex items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/accounting/labor-rates" className="text-xs text-amber-400 hover:text-amber-300 font-body">Labor rates →</Link>
      </div>

      <div className="text-xs font-body text-zinc-400">
        Work in progress: <span className="text-white font-semibold">{fmtCents(totalWip)}</span> across {openJobs} unsettled job(s).
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Work order</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Materials</th>
              <th className="px-4 py-2.5 text-right">Labor (hrs)</th>
              <th className="px-4 py-2.5 text-right">Labor cost</th>
              <th className="px-4 py-2.5 text-right">Total cost</th>
              <th className="px-4 py-2.5 text-right">In WIP</th>
              <th className="px-4 py-2.5">Settled</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No jobs with cost activity yet. Costs appear once parts are issued to a build or labor is clocked against a work order.
                </td>
              </tr>
            ) : (
              jobs.map((j) => (
                <tr key={j.workOrderId} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5">
                    <Link href={`/accounting/job-costing/${j.workOrderId}`} className="font-mono text-xs text-white hover:text-amber-300">
                      {j.woNumber ?? j.workOrderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs capitalize text-zinc-400">{j.status}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtCents(j.materialsCents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">{j.laborHours.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtCents(j.laborCents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white font-semibold">{fmtCents(j.totalCents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-amber-300">{fmtCents(j.wipBalanceCents)}</td>
                  <td className="px-4 py-2.5">
                    {j.settled ? (
                      <span className="text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 text-emerald-400 bg-emerald-500/10">settled</span>
                    ) : (
                      <span className="text-[10px] font-body uppercase tracking-wider rounded px-2 py-0.5 text-zinc-400 bg-white/5">open</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Materials come from parts issued to the build (posted to Work in Progress at FIFO cost). Labor is hours from the
        time clock valued at each tech&apos;s cost rate — informational here and expensed through payroll, not double-booked.
        Settling a job moves its remaining WIP to Cost of Goods Sold.
      </p>
    </AppShell>
  );
}
