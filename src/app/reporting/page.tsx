import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const REPORTS = [
  {
    href: "/reporting/lead-sources",
    title: "Lead sources",
    description: "Marketing attribution: leads / revenue / close rate / cycle by source. Windowed by 30/90/365 days or all-time.",
  },
];

export default async function ReportingIndex() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <AppShell title="Reporting" subtitle="Operational dashboards">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="bg-[#161624] border border-white/5 rounded-lg p-4 hover:border-amber-500/30 transition-colors"
          >
            <h3 className="text-sm font-body font-semibold text-white">{r.title}</h3>
            <p className="text-[11px] text-zinc-400 font-body mt-1">{r.description}</p>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
