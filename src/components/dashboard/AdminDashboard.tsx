import { adminKpis, adminActionItems } from "@/lib/dashboard/metrics";
import { KpiCard } from "./KpiCard";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function days(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)} d`;
}

export async function AdminDashboard() {
  const [kpis, items] = await Promise.all([adminKpis(), adminActionItems()]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Monthly Revenue" value={money(kpis.monthlyRevenue)} accent="green" hint="Proxy: converted quotes" />
        <KpiCard label="Monthly Expenses" value={money(kpis.monthlyExpenses)} accent="red" hint="Proxy: received POs" />
        <KpiCard label="Net Profit" value={money(kpis.netProfit)} accent={kpis.netProfit >= 0 ? "green" : "red"} />
        <KpiCard label="Outstanding Receivables" value={money(kpis.outstandingReceivables)} accent="amber" hint="Proxy: open won-bucket deals" />
        <KpiCard label="Avg Days to Payment" value={days(kpis.avgDaysToPayment)} hint="Lead → won, 90d" />
        <KpiCard label="Avg Time Per Upfit" value={days(kpis.avgUpfitDays)} hint="Last 90 days" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <ListPanel title="Invoices past due" emptyText="No past-due invoices.">
          {items.pastDueInvoices.map((q) => (
            <li key={q.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={q.dealId ? `/deals/${q.dealId}` : `/quotes/${q.id}`} className="text-white hover:text-amber-300">
                {q.quoteNumber ?? q.id.slice(0, 8)}
              </a>
              <span className="text-zinc-500 ml-2">· {q.customerName} · {q.daysSince}d · {money(q.grandTotal)}</span>
            </li>
          ))}
        </ListPanel>
        <ListPanel title="Large open deals" emptyText="No open deals.">
          {items.largeOpen.map((d) => (
            <li key={d.dealId} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/deals/${d.dealId}`} className="text-white hover:text-amber-300">{d.customerName}</a>
              <span className="text-amber-300 ml-2">· {money(d.value)}</span>
            </li>
          ))}
        </ListPanel>
        <ListPanel title="Expiring credentials" emptyText="No credentials expiring.">
          {items.expiringCreds.map((c) => (
            <li key={c.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/deals/${c.dealId}?tab=credentials`} className="text-white hover:text-amber-300">{c.credentialType}</a>
              {c.expiresAt ? <span className="text-zinc-500 ml-2">· {new Date(c.expiresAt).toLocaleDateString()}</span> : null}
            </li>
          ))}
        </ListPanel>
        <ListPanel title="Inactive customers (6mo+)" emptyText="No inactive customers.">
          {items.inactiveCustomers.map((c) => (
            <li key={c.id} className="text-xs font-body py-1 border-t border-white/5">
              <a href={`/crm/${c.id}`} className="text-white hover:text-amber-300">{c.name}</a>
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
    <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">{title}</h3>
      <ul className="mt-2">
        {empty ? <li className="text-xs text-zinc-500 font-body py-1">{emptyText}</li> : children}
      </ul>
    </div>
  );
}
