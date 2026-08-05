import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import { promoSavingsReport } from "@/lib/promoReport";

export const dynamic = "force-dynamic";

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function PromoSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 90);

  const from = parseDate(sp.from, defaultFrom);
  const toInclusive = parseDate(sp.to, today);
  // Exclusive upper bound = the day after `to`, so the whole `to` day is included.
  const toExclusive = new Date(toInclusive);
  toExclusive.setDate(toExclusive.getDate() + 1);

  const report = await promoSavingsReport({ from, to: toExclusive });
  const t = report.totals;
  const net = t.netSavingCents;

  return (
    <AppShell title="Promo vs backfill savings" subtitle="Did buying packages actually save money, after backfill?">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/vendor-promos" className="text-xs text-amber-400 hover:text-amber-300 font-body">Vendor promos →</Link>
        <Link href="/backfill" className="text-xs text-amber-400 hover:text-amber-300 font-body">Backfill →</Link>
        <form method="get" className="flex items-end gap-2 ml-auto">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            From
            <input type="date" name="from" defaultValue={iso(from)} className="block bg-black/40 border border-white/10 rounded-md px-2 py-1 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            To
            <input type="date" name="to" defaultValue={iso(toInclusive)} className="block bg-black/40 border border-white/10 rounded-md px-2 py-1 text-xs text-white" />
          </label>
          <button className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-1.5">Apply</button>
        </form>
      </div>

      {/* Headline */}
      <div
        className={`rounded-lg border px-4 py-4 font-body ${
          net >= 0 ? "border-emerald-500/25 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
        }`}
      >
        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Net saving from packages, after backfill</div>
        <div className={`font-display font-bold text-3xl mt-1 ${net >= 0 ? "text-emerald-300" : "text-red-300"}`}>
          {fmtCents(net)}
        </div>
        <div className="text-xs text-zinc-400 mt-1">
          Package discount captured {fmtCents(t.packageSavingCents)} − extra spent backfilling at full price{" "}
          {fmtCents(t.backfillPremiumCents)}.{" "}
          {net >= 0
            ? "Packages are ahead over this period."
            : "Backfill spend has eaten the package saving — reconsider the packages flagged below."}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Package units" value={t.packageUnits.toString()} hint={`allocated ${fmtCents(t.packageCostCents)}`} />
        <Stat label="À la carte value" value={fmtCents(t.packageAlacarteCents)} hint="of those package units" />
        <Stat label="Backfill units" value={t.backfillUnits.toString()} hint={`cost ${fmtCents(t.backfillCostCents)}`} />
        <Stat label="Individual units" value={t.individualUnits.toString()} hint={`cost ${fmtCents(t.individualCostCents)}`} />
      </div>

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          By SKU ({report.rows.length}) · {iso(from)} → {iso(toInclusive)}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">SKU</th>
              <th className="px-3 py-2.5">Part</th>
              <th className="px-3 py-2.5 text-right">Pkg units</th>
              <th className="px-3 py-2.5 text-right">Pkg cost</th>
              <th className="px-3 py-2.5 text-right">Pkg saving</th>
              <th className="px-3 py-2.5 text-right">Backfill units</th>
              <th className="px-3 py-2.5 text-right">Backfill premium</th>
              <th className="px-3 py-2.5 text-right">Consumed</th>
              <th className="px-3 py-2.5 text-right">Net saving</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No package or backfill receipts in this period.
                </td>
              </tr>
            ) : (
              report.rows.map((r) => (
                <tr key={r.partId} className={`border-t border-white/5 ${r.reconsider ? "bg-amber-500/5" : ""}`}>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-300">{r.sku ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-white">{r.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-xs">{r.packageUnits}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-400">{fmtCents(r.packageCostCents)}</td>
                  <td className="px-3 py-2 text-right text-xs text-emerald-300">{fmtCents(r.packageSavingCents)}</td>
                  <td className="px-3 py-2 text-right text-xs">{r.backfillUnits}</td>
                  <td className="px-3 py-2 text-right text-xs text-red-300">{fmtCents(r.backfillPremiumCents)}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-400">{r.consumedUnits}</td>
                  <td className={`px-3 py-2 text-right text-xs font-semibold ${r.netSavingCents >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                    {fmtCents(r.netSavingCents)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.reconsider ? (
                      <span
                        className="text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-300 rounded px-1.5 py-0.5"
                        title={`Backfill is ${Math.round((r.backfillShare ?? 0) * 100)}% of package volume`}
                      >
                        reconsider
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Built from the cost-layer table&apos;s <span className="font-mono">source_kind</span> + per-layer cost, not from
        job costing — under weighted average the promo saving is smeared into the average and invisible there.
        <span className="font-mono"> Pkg saving</span> = à la carte basis − allocated cost on package receipts.
        <span className="font-mono"> Backfill premium</span> = extra paid per backfilled unit over the package unit
        cost. A SKU is flagged <span className="text-amber-300">reconsider</span> when backfill volume is at least half
        its package volume — the discount is being handed back at full price.
      </p>
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface border border-white/5 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">{label}</div>
      <div className="mt-1 font-display font-bold text-white text-lg">{value}</div>
      {hint ? <div className="text-[10px] text-zinc-500 font-body mt-0.5">{hint}</div> : null}
    </div>
  );
}
