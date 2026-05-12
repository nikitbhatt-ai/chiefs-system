import { salesKpis, salesActionItems } from "@/lib/dashboard/metrics";
import { KpiCard } from "./KpiCard";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}
function days(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)} d`;
}

export async function SalesDashboard({ userId }: { userId: string | null }) {
  const [kpis, items] = await Promise.all([salesKpis(userId), salesActionItems(userId)]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Open Deals" value={String(kpis.openDeals)} href="/deals" />
        <KpiCard label="Pipeline Value" value={money(kpis.pipelineValue)} accent="amber" href="/pipeline" />
        <KpiCard label="Closed This Month" value={String(kpis.closedThisMonth)} accent="green" />
        <KpiCard label="Revenue This Month" value={money(kpis.revenueThisMonth)} accent="green" hint="Proxy: converted quotes" />
        <KpiCard label="Win Rate (90d)" value={pct(kpis.winRate)} />
        <KpiCard label="Avg Deal Cycle" value={days(kpis.avgCycleDays)} hint="Lead → delivered" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ListPanel title="Stalled deals" emptyText="No stalled deals.">
          {items.stalledDeals.map((d) => (
            <li key={d.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/deals/${d.id}`} className="text-white hover:text-amber-300">{d.customerName}</a>
              <span className="text-zinc-500 ml-2">· {d.stage.replace(/_/g, " ")} · {d.daysInStage}d in stage</span>
            </li>
          ))}
        </ListPanel>
        <ListPanel title="Quotes awaiting response" emptyText="All quotes have moved.">
          {items.quotesAwaitingResponse.map((q) => (
            <li key={q.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={q.dealId ? `/deals/${q.dealId}` : `/quotes/${q.id}`} className="text-white hover:text-amber-300">
                {q.quoteNumber ?? q.id.slice(0, 8)}
              </a>
              <span className="text-zinc-500 ml-2">· {q.customerName} · {q.daysSince}d since</span>
            </li>
          ))}
        </ListPanel>
        <ListPanel title="Tasks due today" emptyText="Nothing due today.">
          {items.tasksDueToday.map((t) => (
            <li key={t.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/deals/${t.dealId}?tab=tasks`} className="text-white hover:text-amber-300">{t.title}</a>
              {t.dueDate ? (
                <span className="text-zinc-500 ml-2">· {new Date(t.dueDate).toLocaleDateString()}</span>
              ) : null}
            </li>
          ))}
        </ListPanel>
      </div>
    </div>
  );
}

function ListPanel({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const empty = items.flat().filter(Boolean).length === 0;
  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">{title}</h3>
      <ul className="mt-2">
        {empty ? <li className="text-xs text-zinc-500 font-body py-1">{emptyText}</li> : children}
      </ul>
    </div>
  );
}
