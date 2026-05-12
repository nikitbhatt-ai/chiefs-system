import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { leads, deals, quotes } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { bucketForStage } from "@/lib/pipelineBuckets";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { slug: "30", label: "30 days", days: 30 },
  { slug: "90", label: "90 days", days: 90 },
  { slug: "365", label: "365 days", days: 365 },
  { slug: "all", label: "All-time", days: null },
] as const;

type WindowSlug = (typeof WINDOWS)[number]["slug"];

function isWindowSlug(v: string): v is WindowSlug {
  return WINDOWS.some((w) => w.slug === v);
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(num: number, den: number): string {
  if (den === 0) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default async function LeadSourcesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const params = await searchParams;
  const windowSlug: WindowSlug = isWindowSlug(params.window ?? "") ? (params.window as WindowSlug) : "90";
  const windowDef = WINDOWS.find((w) => w.slug === windowSlug)!;
  const since = windowDef.days
    ? new Date(Date.now() - windowDef.days * 24 * 60 * 60 * 1000)
    : null;

  // 1. Pull leads in the window (or all). 2. Pull the deals they converted
  // into. 3. Pull the latest quote per deal (one query — we'll group in TS).
  // Everything aggregates in memory; expected row counts are O(thousands) at
  // most for the lifetime of the business.
  const leadRows = await db
    .select()
    .from(leads)
    .where(since ? gte(leads.createdAt, since) : undefined as never)
    .orderBy(desc(leads.createdAt));

  const dealIds = Array.from(
    new Set(leadRows.map((l) => l.convertedDealId).filter(Boolean) as string[]),
  );
  const dealRows = dealIds.length
    ? await db.select().from(deals).where(inArray(deals.id, dealIds))
    : [];
  const dealMap = new Map(dealRows.map((d) => [d.id, d]));

  const quoteRows = dealIds.length
    ? await db
        .select({ id: quotes.id, dealId: quotes.dealId, grandTotal: quotes.grandTotal, updatedAt: quotes.updatedAt })
        .from(quotes)
        .where(inArray(quotes.dealId, dealIds))
        .orderBy(desc(quotes.updatedAt))
    : [];
  // Latest quote per deal — quoteRows is already ordered by updatedAt desc.
  const latestQuoteByDeal = new Map<string, number>();
  for (const q of quoteRows) {
    if (!q.dealId) continue;
    if (latestQuoteByDeal.has(q.dealId)) continue;
    latestQuoteByDeal.set(q.dealId, Number(q.grandTotal ?? 0) || 0);
  }

  type Agg = {
    source: string;
    leadCount: number;
    convertedCount: number;
    wonCount: number;
    deliveredCount: number;
    revenue: number;
    cycleDaysTotal: number;
    cycleDaysSamples: number;
    byCustomerType: Map<string, number>;
  };
  const byType = new Set<string>();
  const acc = new Map<string, Agg>();
  function get(source: string): Agg {
    let a = acc.get(source);
    if (!a) {
      a = {
        source,
        leadCount: 0,
        convertedCount: 0,
        wonCount: 0,
        deliveredCount: 0,
        revenue: 0,
        cycleDaysTotal: 0,
        cycleDaysSamples: 0,
        byCustomerType: new Map(),
      };
      acc.set(source, a);
    }
    return a;
  }

  for (const l of leadRows) {
    const src = l.source && l.source.trim() ? l.source : "(no source)";
    const a = get(src);
    a.leadCount += 1;
    const ct = l.customerType ?? "(unset)";
    byType.add(ct);
    a.byCustomerType.set(ct, (a.byCustomerType.get(ct) ?? 0) + 1);
    if (l.convertedDealId) a.convertedCount += 1;
    const deal = l.convertedDealId ? dealMap.get(l.convertedDealId) : null;
    if (deal) {
      const bucket = bucketForStage(deal.stage);
      if (bucket === "won" || bucket === "build" || bucket === "delivery" || bucket === "post_sale") {
        a.wonCount += 1;
        a.revenue += latestQuoteByDeal.get(deal.id) ?? 0;
      }
      if (deal.stage === "delivered") {
        a.deliveredCount += 1;
        const startedMs = l.createdAt.getTime();
        const endedMs = (deal.currentStageEnteredAt ?? deal.updatedAt).getTime();
        const days = Math.max(0, (endedMs - startedMs) / (1000 * 60 * 60 * 24));
        a.cycleDaysTotal += days;
        a.cycleDaysSamples += 1;
      }
    }
  }

  const rows = Array.from(acc.values()).sort((x, y) => y.leadCount - x.leadCount);
  const customerTypes = Array.from(byType).sort();

  const totals = {
    leadCount: rows.reduce((s, r) => s + r.leadCount, 0),
    convertedCount: rows.reduce((s, r) => s + r.convertedCount, 0),
    wonCount: rows.reduce((s, r) => s + r.wonCount, 0),
    deliveredCount: rows.reduce((s, r) => s + r.deliveredCount, 0),
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    cycleDaysTotal: rows.reduce((s, r) => s + r.cycleDaysTotal, 0),
    cycleDaysSamples: rows.reduce((s, r) => s + r.cycleDaysSamples, 0),
  };

  return (
    <AppShell title="Reporting · Lead sources" subtitle={`Window: ${windowDef.label}`}>
      <div className="flex gap-2 flex-wrap">
        {WINDOWS.map((w) => (
          <a
            key={w.slug}
            href={`/reporting/lead-sources?window=${w.slug}`}
            className={`text-[11px] font-body px-3 py-1.5 rounded-md border ${
              windowSlug === w.slug
                ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                : "border-white/10 text-zinc-400 hover:text-white"
            }`}
          >
            {w.label}
          </a>
        ))}
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-xs font-body">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 text-right">Leads</th>
              <th className="px-3 py-2 text-right">Converted</th>
              <th className="px-3 py-2 text-right">Won</th>
              <th className="px-3 py-2 text-right">Revenue</th>
              <th className="px-3 py-2 text-right">Avg deal</th>
              <th className="px-3 py-2 text-right">Close %</th>
              <th className="px-3 py-2 text-right">Cycle days</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                  No leads in this window.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.source} className="border-t border-white/5">
                  <td className="px-3 py-2 text-white">{r.source}</td>
                  <td className="px-3 py-2 text-right text-zinc-200">{r.leadCount}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.convertedCount}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{r.wonCount}</td>
                  <td className="px-3 py-2 text-right text-green-300">{fmtMoney(r.revenue)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.wonCount > 0 ? fmtMoney(r.revenue / r.wonCount) : "—"}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{fmtPct(r.wonCount, r.leadCount)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.cycleDaysSamples > 0 ? (r.cycleDaysTotal / r.cycleDaysSamples).toFixed(1) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-white/5">
              <tr className="text-[10px] uppercase tracking-wider text-zinc-400">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{totals.leadCount}</td>
                <td className="px-3 py-2 text-right">{totals.convertedCount}</td>
                <td className="px-3 py-2 text-right">{totals.wonCount}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(totals.revenue)}</td>
                <td className="px-3 py-2 text-right">{totals.wonCount > 0 ? fmtMoney(totals.revenue / totals.wonCount) : "—"}</td>
                <td className="px-3 py-2 text-right">{fmtPct(totals.wonCount, totals.leadCount)}</td>
                <td className="px-3 py-2 text-right">{totals.cycleDaysSamples > 0 ? (totals.cycleDaysTotal / totals.cycleDaysSamples).toFixed(1) : "—"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-white/5">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Source × customer type</h3>
        </div>
        <table className="w-full text-xs font-body">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2">Source</th>
              {customerTypes.map((ct) => (
                <th key={ct} className="px-3 py-2 text-right">{ct}</th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source} className="border-t border-white/5">
                <td className="px-3 py-2 text-white">{r.source}</td>
                {customerTypes.map((ct) => (
                  <td key={ct} className="px-3 py-2 text-right text-zinc-300">{r.byCustomerType.get(ct) ?? 0}</td>
                ))}
                <td className="px-3 py-2 text-right text-zinc-200">{r.leadCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
