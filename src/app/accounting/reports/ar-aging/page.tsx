import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { arAging, AGING_LABELS, type AgingBucket } from "@/lib/reports";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const BUCKETS: AgingBucket[] = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"];

export default async function ArAgingPage() {
  const report = await arAging();

  return (
    <AppShell title="A/R aging" subtitle="Open customer invoices by days past due">
      <Link href="/accounting/reports" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Reports</Link>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {BUCKETS.map((b) => (
          <div key={b} className="bg-[#161624] border border-white/5 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">{AGING_LABELS[b]}</div>
            <div className="text-white font-mono text-sm mt-1">{fmtCents(report.totals[b])}</div>
          </div>
        ))}
        <div className="bg-[#161624] border border-amber-500/20 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-400/80 font-body">Total AR</div>
          <div className="text-white font-mono text-sm mt-1 font-semibold">{fmtCents(report.grandTotal)}</div>
        </div>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Invoice</th>
              <th className="px-4 py-2.5">Customer</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5">Bucket</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {report.rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">No open receivables.</td></tr>
            ) : (
              report.rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5">
                    <Link href={`/accounting/invoices/${r.id}`} className="font-mono text-xs text-white hover:text-amber-300">{r.number}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{r.party}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDate(r.dueDate)}</td>
                  <td className="px-4 py-2.5 text-xs">{AGING_LABELS[r.bucket]}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(r.balanceCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
