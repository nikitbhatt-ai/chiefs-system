import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { profitAndLoss } from "@/lib/reports";
import { fmtDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

function parseRange(sp: Record<string, string | string[] | undefined>) {
  const today = new Date();
  const y = today.getFullYear();
  const from = typeof sp.from === "string" && sp.from ? new Date(`${sp.from}T00:00:00`) : new Date(`${y}-01-01T00:00:00`);
  const to = typeof sp.to === "string" && sp.to ? new Date(`${sp.to}T23:59:59`) : today;
  return { from, to };
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { from, to } = parseRange(sp);
  const pl = await profitAndLoss(from, to);

  const delta = (cur: number, prior: number) => cur - prior;
  const amountCell = (cents: number) => <td className="px-4 py-2 text-right font-mono text-xs text-white">{fmtCents(cents)}</td>;
  const priorCell = (cents: number) => <td className="px-4 py-2 text-right font-mono text-xs text-zinc-500">{fmtCents(cents)}</td>;
  const deltaCell = (d: number) => (
    <td className={`px-4 py-2 text-right font-mono text-xs ${d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-zinc-500"}`}>
      {d === 0 ? "—" : `${d > 0 ? "+" : ""}${fmtCents(d)}`}
    </td>
  );

  // Match prior-period rows to current by code/department for the comparison column.
  const priorRevByCode = new Map(pl.prior.revenue.map((r) => [r.code, r.amountCents]));
  const priorCogsPartsByCode = new Map(pl.prior.cogsParts.map((r) => [r.code, r.amountCents]));
  const priorCogsLaborByCode = new Map(pl.prior.cogsLabor.map((r) => [r.code, r.amountCents]));
  const priorCogsOtherByCode = new Map(pl.prior.cogsOther.map((r) => [r.code, r.amountCents]));
  const priorOtherByCode = new Map(pl.prior.otherExpense.map((r) => [r.code, r.amountCents]));
  const priorLaborByDept = new Map(pl.prior.laborByDept.map((r) => [r.departmentName, r.amountCents]));

  return (
    <AppShell title="Profit & Loss" subtitle={`${fmtDate(from)} – ${fmtDate(to)} vs prior period`}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/accounting/reports" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Reports</Link>
        <form method="get" className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">From
            <input type="date" name="from" defaultValue={iso(from)} className="block bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white mt-1" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">To
            <input type="date" name="to" defaultValue={iso(to)} className="block bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white mt-1" />
          </label>
          <button type="submit" className="text-xs font-body font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-200 rounded-md px-3 py-2">Apply</button>
        </form>
        <a
          href={`/api/accounting/reports/pnl/csv?from=${iso(from)}&to=${iso(to)}`}
          className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-2"
        >
          Export CSV
        </a>
      </div>

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5 text-right">This period</th>
              <th className="px-4 py-2.5 text-right">Prior period</th>
              <th className="px-4 py-2.5 text-right">Change</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {/* Revenue */}
            <SectionHeader label="Revenue" />
            {pl.current.revenue.map((r) => (
              <tr key={r.code} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-4 py-2 text-xs">
                  <Link href={`/accounting/reports/ledger/${r.code}?from=${iso(from)}&to=${iso(to)}`} className="hover:text-amber-300">
                    <span className="font-mono text-zinc-500">{r.code}</span> {r.name}
                  </Link>
                </td>
                {amountCell(r.amountCents)}
                {priorCell(priorRevByCode.get(r.code) ?? 0)}
                {deltaCell(delta(r.amountCents, priorRevByCode.get(r.code) ?? 0))}
              </tr>
            ))}
            <TotalRow label="Total revenue" cur={pl.current.revenueTotal} prior={pl.prior.revenueTotal} />

            {/* Cost of Goods Sold — its own section above gross profit, split
                into the components installed on vehicles and direct labor. */}
            <SectionHeader label="Cost of Goods Sold — parts & materials" />
            {pl.current.cogsParts.map((r) => (
              <tr key={r.code} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-4 py-2 text-xs pl-8">
                  <Link href={`/accounting/reports/ledger/${r.code}?from=${iso(from)}&to=${iso(to)}`} className="hover:text-amber-300">
                    <span className="font-mono text-zinc-400">{r.code}</span> {r.name}
                  </Link>
                </td>
                {amountCell(r.amountCents)}
                {priorCell(priorCogsPartsByCode.get(r.code) ?? 0)}
                {deltaCell(delta(r.amountCents, priorCogsPartsByCode.get(r.code) ?? 0))}
              </tr>
            ))}
            <TotalRow label="Total parts & materials" cur={pl.current.cogsPartsTotal} prior={pl.prior.cogsPartsTotal} />

            <SectionHeader label="Cost of Goods Sold — direct labor" />
            {pl.current.cogsLabor.map((r) => (
              <tr key={r.code} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-4 py-2 text-xs pl-8">
                  <Link href={`/accounting/reports/ledger/${r.code}?from=${iso(from)}&to=${iso(to)}`} className="hover:text-amber-300">
                    <span className="font-mono text-zinc-400">{r.code}</span> {r.name}
                  </Link>
                </td>
                {amountCell(r.amountCents)}
                {priorCell(priorCogsLaborByCode.get(r.code) ?? 0)}
                {deltaCell(delta(r.amountCents, priorCogsLaborByCode.get(r.code) ?? 0))}
              </tr>
            ))}
            <TotalRow label="Total direct labor" cur={pl.current.cogsLaborTotal} prior={pl.prior.cogsLaborTotal} />

            {/* Variances and adjustments. Only shown when there are any — an
                always-visible empty section makes the report harder to read. */}
            {(pl.current.cogsOther.length > 0 || pl.current.cogsOtherTotal !== 0) && (
              <>
                <SectionHeader label="Cost of Goods Sold — variances & adjustments" />
                {pl.current.cogsOther.map((r) => (
                  <tr key={r.code} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2 text-xs pl-8">
                      <Link href={`/accounting/reports/ledger/${r.code}?from=${iso(from)}&to=${iso(to)}`} className="hover:text-amber-300">
                        <span className="font-mono text-zinc-400">{r.code}</span> {r.name}
                      </Link>
                    </td>
                    {amountCell(r.amountCents)}
                    {priorCell(priorCogsOtherByCode.get(r.code) ?? 0)}
                    {deltaCell(delta(r.amountCents, priorCogsOtherByCode.get(r.code) ?? 0))}
                  </tr>
                ))}
                <TotalRow label="Total variances & adjustments" cur={pl.current.cogsOtherTotal} prior={pl.prior.cogsOtherTotal} />
              </>
            )}

            <TotalRow label="Total cost of goods sold" cur={pl.current.cogsTotal} prior={pl.prior.cogsTotal} />

            {/* Gross profit — the figure the shop is actually managed by. */}
            <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-semibold">
              <td className="px-4 py-3 text-sm text-white">Gross profit</td>
              <td className={`px-4 py-3 text-right font-mono ${pl.current.grossProfitCents >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {fmtCents(pl.current.grossProfitCents)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-zinc-500">{fmtCents(pl.prior.grossProfitCents)}</td>
              {deltaCell(delta(pl.current.grossProfitCents, pl.prior.grossProfitCents))}
            </tr>

            {/* Operating payroll by department */}
            <SectionHeader label="Operating payroll & benefits (by department)" />
            {pl.current.laborByDept.map((r) => (
              <tr key={r.departmentName} className="border-t border-white/5">
                <td className="px-4 py-2 text-xs pl-8">{r.departmentName}</td>
                {amountCell(r.amountCents)}
                {priorCell(priorLaborByDept.get(r.departmentName) ?? 0)}
                {deltaCell(delta(r.amountCents, priorLaborByDept.get(r.departmentName) ?? 0))}
              </tr>
            ))}
            <TotalRow label="Total payroll & benefits" cur={pl.current.laborTotal} prior={pl.prior.laborTotal} />

            {/* Other operating expenses */}
            <SectionHeader label="Other operating expenses" />
            {pl.current.otherExpense.map((r) => (
              <tr key={r.code} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-4 py-2 text-xs">
                  <Link href={`/accounting/reports/ledger/${r.code}?from=${iso(from)}&to=${iso(to)}`} className="hover:text-amber-300">
                    <span className="font-mono text-zinc-500">{r.code}</span> {r.name}
                  </Link>
                </td>
                {amountCell(r.amountCents)}
                {priorCell(priorOtherByCode.get(r.code) ?? 0)}
                {deltaCell(delta(r.amountCents, priorOtherByCode.get(r.code) ?? 0))}
              </tr>
            ))}
            <TotalRow label="Total other operating" cur={pl.current.otherExpenseTotal} prior={pl.prior.otherExpenseTotal} />
            <TotalRow label="Total operating expenses" cur={pl.current.operatingTotal} prior={pl.prior.operatingTotal} />
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-white/20 font-body font-bold text-white">
              <td className="px-4 py-3">Net income</td>
              <td className={`px-4 py-3 text-right font-mono ${pl.current.netCents >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtCents(pl.current.netCents)}</td>
              <td className="px-4 py-3 text-right font-mono text-zinc-500">{fmtCents(pl.prior.netCents)}</td>
              {deltaCell(delta(pl.current.netCents, pl.prior.netCents))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-zinc-500 font-body">
        Prior period = the {Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000))}-day window immediately
        before this one ({fmtDate(pl.priorFrom)} – {fmtDate(pl.priorTo)}). Click a revenue or expense account to drill
        into its transactions.
      </p>
    </AppShell>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-white/[0.03]">
      <td colSpan={4} className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-amber-400/80 font-body font-semibold">{label}</td>
    </tr>
  );
}

function TotalRow({ label, cur, prior }: { label: string; cur: number; prior: number }) {
  const d = cur - prior;
  return (
    <tr className="border-t border-white/10 font-body font-semibold text-white bg-white/[0.02]">
      <td className="px-4 py-2 text-xs">{label}</td>
      <td className="px-4 py-2 text-right font-mono text-xs">{fmtCents(cur)}</td>
      <td className="px-4 py-2 text-right font-mono text-xs text-zinc-500">{fmtCents(prior)}</td>
      <td className={`px-4 py-2 text-right font-mono text-xs ${d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-zinc-500"}`}>{d === 0 ? "—" : `${d > 0 ? "+" : ""}${fmtCents(d)}`}</td>
    </tr>
  );
}
