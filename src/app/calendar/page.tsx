import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, customers, deals, workOrders } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export const dynamic = "force-dynamic";

// Optional record-link dropdowns are populated with the most recent N of each,
// which is plenty for an internal shop. (If these lists ever need to be
// exhaustive we'll swap in a search box — noted in REQUIREMENTS.)
const LINK_LIMIT = 100;

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user) return null;

  const [userRows, customerRows, dealRows, woRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, displayName: users.displayName })
      .from(users)
      .where(eq(users.active, true)),
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.archived, false))
      .orderBy(desc(customers.updatedAt))
      .limit(LINK_LIMIT),
    db
      .select({
        id: deals.id,
        year: deals.vehicleYear,
        make: deals.vehicleMake,
        model: deals.vehicleModel,
      })
      .from(deals)
      .where(eq(deals.archived, false))
      .orderBy(desc(deals.updatedAt))
      .limit(LINK_LIMIT),
    db
      .select({ id: workOrders.id, woNumber: workOrders.woNumber })
      .from(workOrders)
      .where(eq(workOrders.archived, false))
      .orderBy(desc(workOrders.createdAt))
      .limit(LINK_LIMIT),
  ]);

  const usersList = userRows
    .map((u) => ({ id: u.id, name: u.displayName || u.name || "Unnamed" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const customersList = customerRows.map((c) => ({ id: c.id, label: c.name }));

  const dealsList = dealRows.map((d) => ({
    id: d.id,
    label: [d.year, d.make, d.model].filter(Boolean).join(" ") || `Deal ${d.id.slice(0, 8)}`,
  }));

  const workOrdersList = woRows.map((w) => ({
    id: w.id,
    label: w.woNumber ?? `WO ${w.id.slice(0, 8)}`,
  }));

  return (
    <AppShell title="Team Calendar" subtitle="Shared shop calendar — service, upfits, deliveries, and shop notices (times are shop-local, CT)">
      <CalendarClient
        currentUserId={session.user.id}
        role={session.user.role ?? null}
        users={usersList}
        customers={customersList}
        deals={dealsList}
        workOrders={workOrdersList}
      />
    </AppShell>
  );
}
