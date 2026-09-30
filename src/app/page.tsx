import { asc, eq, isNull, and, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/db";
import { dealTasks, deals, customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { SalesDashboard } from "@/components/dashboard/SalesDashboard";
import { OperationsDashboard } from "@/components/dashboard/OperationsDashboard";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";

export const dynamic = "force-dynamic";

type View = "sales" | "operations" | "admin";

function defaultViewForRole(role: string | null | undefined): View {
  if (role === "admin" || role === "manager" || role === "accountant") return "admin";
  if (role === "sales") return "sales";
  if (role === "warehouse" || role === "tech") return "operations";
  return "sales";
}

function isView(s: string | null | undefined): s is View {
  return s === "sales" || s === "operations" || s === "admin";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const role = (session.user as { role?: string }).role ?? null;
  const sp = await searchParams;
  // Admin / manager / accountant can switch views via ?view=. Everyone
  // else is locked to the default for their role — keeps the UI focused
  // on what they need.
  const canSwitch = role === "admin" || role === "manager" || role === "accountant";
  const requested = isView(sp.view ?? "") ? (sp.view as View) : null;
  const view: View = canSwitch && requested ? requested : defaultViewForRole(role);

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

  const subtitle = ({ sales: "Sales view", operations: "Operations view", admin: "Admin view" } as const)[view];

  return (
    <AppShell title="Dashboard" subtitle={subtitle}>
      {canSwitch && (
        <div className="flex gap-2 flex-wrap">
          {(["sales", "operations", "admin"] as const).map((v) => (
            <Link
              key={v}
              href={`/?view=${v}`}
              className={`text-[11px] font-body px-3 py-1.5 rounded-md border ${
                view === v
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                  : "border-white/10 text-zinc-400 hover:text-white"
              }`}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </Link>
          ))}
        </div>
      )}

      {view === "sales" && <SalesDashboard userId={session.user.id} />}
      {view === "operations" && <OperationsDashboard />}
      {view === "admin" && <AdminDashboard />}

      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
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
    </AppShell>
  );
}
