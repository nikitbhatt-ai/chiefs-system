import { AppShell } from "@/components/AppShell";

export default async function DashboardPage() {
  return (
    <AppShell title="Dashboard" subtitle="Operational overview">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Open Deals", value: "—" },
          { label: "Vehicles On Lot", value: "—" },
          { label: "Work Orders In Progress", value: "—" },
          { label: "POs Pending Receipt", value: "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#161624] border border-white/5 rounded-lg p-4"
          >
            <div className="text-[10px] text-zinc-500 font-body uppercase tracking-wider">
              {stat.label}
            </div>
            <div className="text-2xl font-display font-bold text-white mt-1">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[#161624] border border-amber-500/20 rounded-lg p-4">
        <div className="text-[10px] text-amber-400 font-body font-semibold uppercase tracking-wider mb-1">
          Build status
        </div>
        <p className="text-xs text-zinc-300 font-body leading-relaxed">
          Customers (CRM) is live. Next up: Leads, Vehicles, Quotes, Work Orders,
          Inventory, Purchase Orders, Vendors, Timeclock, Reporting.
        </p>
      </div>
    </AppShell>
  );
}
