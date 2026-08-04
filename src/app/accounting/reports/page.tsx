import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const REPORTS = [
  { href: "/accounting/reports/pnl", title: "Profit & Loss", desc: "Revenue → Labor (by department) → Other expenses → Net, with prior-period comparison, drill-down, and CSV export." },
  { href: "/accounting/reports/balance-sheet", title: "Balance sheet", desc: "Assets, liabilities, and equity as of any date — straight from the ledger." },
  { href: "/accounting/reports/ar-aging", title: "A/R aging", desc: "Open customer invoices bucketed by days past due (not due / 1–30 / 31–60 / 61–90 / 90+)." },
  { href: "/accounting/reports/ap-aging", title: "A/P aging", desc: "Open vendor bills bucketed by days past due." },
];

export default function ReportsIndexPage() {
  return (
    <AppShell title="Financial reports" subtitle="Statements built from the posted ledger">
      <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href} className="block bg-surface border border-white/5 rounded-lg p-5 hover:border-amber-500/40 transition-colors">
            <div className="text-white font-display font-semibold">{r.title}</div>
            <div className="text-xs text-zinc-500 font-body mt-1">{r.desc}</div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
