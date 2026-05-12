import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const REPORTS = [
  {
    href: "/reporting/vendor-lead-times",
    title: "Vendor lead-time variance",
    description: "Actual delivery times vs. quoted lead times by vendor. Use this to tune parts.lead_time_days for vendors who chronically run long.",
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
