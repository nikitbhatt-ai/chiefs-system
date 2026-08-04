import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { balanceSheet, type BsRow } from "@/lib/reports";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asOf = typeof sp.asOf === "string" && sp.asOf ? new Date(`${sp.asOf}T23:59:59`) : new Date();
  const bs = await balanceSheet(asOf);

  const Section = ({ title, rows, total }: { title: string; rows: BsRow[]; total: number }) => (
    <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-amber-400/80 font-body font-semibold">{title}</div>
      <table className="w-full text-sm">
        <tbody className="font-body text-zinc-200">
          {rows.length === 0 ? (
            <tr><td className="px-4 py-3 text-center text-xs text-zinc-500">None</td></tr>
          ) : (
            rows.map((r) => (
              <tr key={r.code} className="border-t border-white/5">
                <td className="px-4 py-2 text-xs"><span className="font-mono text-zinc-500">{r.code}</span> {r.name}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-white">{fmtCents(r.amountCents)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/10 font-body font-semibold text-white bg-white/[0.02]">
            <td className="px-4 py-2 text-xs">Total {title.toLowerCase()}</td>
            <td className="px-4 py-2 text-right font-mono text-xs">{fmtCents(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <AppShell title="Balance sheet" subtitle={`As of ${fmtDate(bs.asOf)}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/accounting/reports" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Reports</Link>
        <form method="get" className="flex items-end gap-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">As of
            <input type="date" name="asOf" defaultValue={iso(asOf)} className="block bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white mt-1" />
          </label>
          <button type="submit" className="text-xs font-body font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-3 py-2">Apply</button>
        </form>
      </div>

      <div
        className={`rounded-lg border px-4 py-3 font-body text-sm ${
          bs.balanced ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"
        }`}
      >
        {bs.balanced ? (
          <><span className="font-semibold">Balanced.</span> Assets {fmtCents(bs.assetsTotal)} = Liabilities + Equity {fmtCents(bs.liabilitiesAndEquityTotal)}.</>
        ) : (
          <><span className="font-semibold">Out of balance!</span> Assets {fmtCents(bs.assetsTotal)} ≠ Liabilities + Equity {fmtCents(bs.liabilitiesAndEquityTotal)}.</>
        )}
      </div>

      <Section title="Assets" rows={bs.assets} total={bs.assetsTotal} />
      <Section title="Liabilities" rows={bs.liabilities} total={bs.liabilitiesTotal} />

      <div className="bg-surface border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-amber-400/80 font-body font-semibold">Equity</div>
        <table className="w-full text-sm">
          <tbody className="font-body text-zinc-200">
            {bs.equity.map((r) => (
              <tr key={r.code} className="border-t border-white/5">
                <td className="px-4 py-2 text-xs"><span className="font-mono text-zinc-500">{r.code}</span> {r.name}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-white">{fmtCents(r.amountCents)}</td>
              </tr>
            ))}
            <tr className="border-t border-white/5">
              <td className="px-4 py-2 text-xs text-zinc-300">Current period net income</td>
              <td className="px-4 py-2 text-right font-mono text-xs text-white">{fmtCents(bs.netIncomeCents)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 font-body font-semibold text-white bg-white/[0.02]">
              <td className="px-4 py-2 text-xs">Total equity</td>
              <td className="px-4 py-2 text-right font-mono text-xs">{fmtCents(bs.equityTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Current-period earnings (revenue − expenses to date) are folded into equity as net income until closed to
        retained earnings. Built from all posted journal entries dated on or before {fmtDate(bs.asOf)}.
      </p>
    </AppShell>
  );
}
