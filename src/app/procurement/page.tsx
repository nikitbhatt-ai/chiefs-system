import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const PAGES = [
  {
    href: "/procurement/parts-to-order",
    title: "Parts to order now",
    description: "Every required part across active work orders whose latest-order-by date is approaching or past, with vendor and lead time. Drives the daily buy plan.",
  },
  {
    href: "/work-orders",
    title: "Work order procurement plan",
    description: "Per-WO target build start, safety buffer, and a critical-path summary of long-lead parts. Edit dates inline.",
  },
  {
    href: "/reporting/vendor-lead-times",
    title: "Vendor lead-time variance",
    description: "Actual delivery times vs. quoted lead times by vendor. Use this to tune parts.lead_time_days for vendors who chronically run long.",
  },
];

export default async function ProcurementIndex() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <AppShell title="Procurement" subtitle="Lead time management & purchase planning">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="bg-[#161624] border border-white/5 rounded-lg p-4 hover:border-amber-500/30 transition-colors"
          >
            <h3 className="text-sm font-body font-semibold text-white">{p.title}</h3>
            <p className="text-[11px] text-zinc-400 font-body mt-1">{p.description}</p>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
