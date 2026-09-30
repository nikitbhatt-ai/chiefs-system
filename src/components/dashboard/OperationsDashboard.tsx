import { operationsKpis, operationsActionItems } from "@/lib/dashboard/metrics";
import { KpiCard } from "./KpiCard";

function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}
function days(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)} d`;
}

export async function OperationsDashboard() {
  const [kpis, items] = await Promise.all([operationsKpis(), operationsActionItems()]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Active Builds" value={String(kpis.activeBuilds)} href="/work-orders" accent="amber" />
        <KpiCard label="Scheduled This Week" value={String(kpis.scheduledThisWeek)} />
        <KpiCard label="Ready for Delivery" value={String(kpis.readyForDelivery)} accent="green" />
        <KpiCard label="Avg Build Days" value={days(kpis.avgBuildDays)} hint="Last 90 days" />
        <KpiCard label="On-Time %" value={pct(kpis.onTimePct)} hint="Proxy: target + 30d" />
        <KpiCard label="Past Due" value={String(kpis.pastDue)} accent={kpis.pastDue > 0 ? "red" : "zinc"} href="/procurement/parts-to-order" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <ListPanel title="Builds awaiting parts" emptyText="No builds waiting on parts.">
          {items.awaitingParts.map((w) => (
            <li key={w.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/work-orders`} className="text-white hover:text-amber-300 font-mono">{w.woNumber ?? w.id.slice(0, 8)}</a>
            </li>
          ))}
        </ListPanel>
        <ListPanel title="POs arriving soon" emptyText="No incoming POs.">
          {items.posArrivingSoon.map((p) => (
            <li key={p.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/purchase-orders/${p.id}`} className="text-white hover:text-amber-300 font-mono">{p.poNumber ?? p.id.slice(0, 8)}</a>
              {p.expectedAt ? <span className="text-zinc-500 ml-2">· {new Date(p.expectedAt).toLocaleDateString()}</span> : null}
            </li>
          ))}
        </ListPanel>
        <ListPanel title="QC pending" emptyText="No builds in QC.">
          {items.qcPending.map((w) => (
            <li key={w.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/work-orders`} className="text-white hover:text-amber-300 font-mono">{w.woNumber ?? w.id.slice(0, 8)}</a>
            </li>
          ))}
        </ListPanel>
        <ListPanel title="Late vendor deliveries" emptyText="All vendors on time.">
          {items.lateVendor.map((p) => (
            <li key={p.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/purchase-orders/${p.id}`} className="text-red-300 hover:text-red-200 font-mono">{p.poNumber ?? p.id.slice(0, 8)}</a>
              {p.expectedAt ? <span className="text-zinc-500 ml-2">· expected {new Date(p.expectedAt).toLocaleDateString()}</span> : null}
            </li>
          ))}
        </ListPanel>
      </div>
    </div>
  );
}

function ListPanel({ title, emptyText, children }: { title: string; emptyText: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const empty = items.flat().filter(Boolean).length === 0;
  return (
    <div className="bg-surface border border-white/5 rounded-lg p-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">{title}</h3>
      <ul className="mt-2">
        {empty ? <li className="text-xs text-zinc-500 font-body py-1">{emptyText}</li> : children}
      </ul>
    </div>
  );
}
