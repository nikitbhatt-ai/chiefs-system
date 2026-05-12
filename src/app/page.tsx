import { asc, eq, isNull, and, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealTasks, deals, customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const tasks = await db
    .select()
    .from(dealTasks)
    .where(and(eq(dealTasks.assignedTo, session.user.id), isNull(dealTasks.completedAt)))
    .orderBy(asc(dealTasks.dueDate));

  const dealIds = Array.from(new Set(tasks.map((t) => t.dealId)));
  const dealRows = dealIds.length
    ? await db
        .select({ id: deals.id, customerId: deals.customerId, vehicleYear: deals.vehicleYear, vehicleMake: deals.vehicleMake, vehicleModel: deals.vehicleModel })
        .from(deals)
        .where(inArray(deals.id, dealIds))
    : [];
  const customerIds = Array.from(new Set(dealRows.map((d) => d.customerId).filter(Boolean) as string[]));
  const customerRows = customerIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
    : [];
  const customerMap = new Map(customerRows.map((c) => [c.id, c.name]));
  const dealMap = new Map(
    dealRows.map((d) => [
      d.id,
      {
        customerName: d.customerId ? customerMap.get(d.customerId) ?? "—" : "—",
        vehicle: [d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ") || null,
      },
    ]),
  );

  const now = Date.now();

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

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">My open tasks</h3>
          <span className="text-[10px] font-body text-zinc-500">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        {tasks.length === 0 ? (
          <p className="text-xs text-zinc-500 font-body">Nothing assigned to you right now.</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => {
              const overdue = t.dueDate && new Date(t.dueDate).getTime() < now;
              const dm = dealMap.get(t.dealId);
              return (
                <li key={t.id} className="bg-black/30 border border-white/5 rounded-md p-2.5 text-xs font-body">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <a href={`/deals/${t.dealId}?tab=tasks`} className="text-white font-semibold hover:text-amber-300">{t.title}</a>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {dm ? `${dm.customerName}${dm.vehicle ? ` · ${dm.vehicle}` : ""}` : t.dealId.slice(0, 8)}
                      </div>
                      {t.description && (<div className="text-zinc-400 text-[11px] mt-1 whitespace-pre-wrap">{t.description}</div>)}
                    </div>
                    <div className="text-right shrink-0 text-[10px]">
                      {t.dueDate ? (
                        <span className={overdue ? "text-red-300" : "text-zinc-500"}>
                          Due {new Date(t.dueDate).toLocaleDateString()}{overdue ? " (overdue)" : ""}
                        </span>
                      ) : (
                        <span className="text-zinc-600">no due date</span>
                      )}
                      {t.department && (<div className="text-zinc-600 uppercase tracking-wider mt-0.5">{t.department}</div>)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
