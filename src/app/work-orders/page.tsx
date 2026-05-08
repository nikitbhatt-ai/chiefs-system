import { revalidatePath } from "next/cache";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { workOrders, customers, quotes, vehicles } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  estimate: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  confirmed: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  awaiting_parts: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  next_in_line: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  in_progress: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  qc_check: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  completed: "bg-green-500/10 text-green-300 border-green-500/30",
  delivered: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

async function deleteWO(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(workOrders).where(eq(workOrders.id, id));
  revalidatePath("/work-orders");
  revalidatePath("/workflow");
}

export default async function WorkOrdersPage() {
  const rows = await db.select().from(workOrders).orderBy(desc(workOrders.createdAt));

  const customerIds = Array.from(
    new Set(rows.map((r) => r.customerId).filter(Boolean) as string[]),
  );
  const quoteIds = Array.from(
    new Set(rows.map((r) => r.quoteId).filter(Boolean) as string[]),
  );
  const vehicleIds = Array.from(
    new Set(rows.map((r) => r.vehicleId).filter(Boolean) as string[]),
  );

  const [customerRows, quoteRows, vehicleRows] = await Promise.all([
    customerIds.length
      ? db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    quoteIds.length
      ? db
          .select({
            id: quotes.id,
            quoteNumber: quotes.quoteNumber,
            grandTotal: quotes.grandTotal,
          })
          .from(quotes)
          .where(inArray(quotes.id, quoteIds))
      : Promise.resolve([] as { id: string; quoteNumber: string | null; grandTotal: string | null }[]),
    vehicleIds.length
      ? db
          .select({
            id: vehicles.id,
            year: vehicles.year,
            make: vehicles.make,
            model: vehicles.model,
            vin: vehicles.vin,
          })
          .from(vehicles)
          .where(inArray(vehicles.id, vehicleIds))
      : Promise.resolve(
          [] as {
            id: string;
            year: number | null;
            make: string | null;
            model: string | null;
            vin: string | null;
          }[],
        ),
  ]);
  const customerMap = new Map(customerRows.map((r) => [r.id, r.name]));
  const quoteMap = new Map(quoteRows.map((r) => [r.id, r]));
  const vehicleMap = new Map(vehicleRows.map((r) => [r.id, r]));

  function fmt(v: string | null | undefined) {
    if (v == null) return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return "—";
    return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  return (
    <AppShell
      title="Work Orders"
      subtitle="Builds in motion — created automatically when a quote moves past Estimate"
    >
      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">WO #</th>
              <th className="px-3 py-2.5">Quote</th>
              <th className="px-3 py-2.5">Customer</th>
              <th className="px-3 py-2.5">Vehicle</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Parts consumed</th>
              <th className="px-3 py-2.5 text-right">Quote total</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No work orders yet — they're auto-created when a quote moves
                  past Estimate on the Workflow board.
                </td>
              </tr>
            ) : (
              rows.map((w) => {
                const q = w.quoteId ? quoteMap.get(w.quoteId) : null;
                const v = w.vehicleId ? vehicleMap.get(w.vehicleId) : null;
                return (
                  <tr key={w.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-white">
                      {w.woNumber ?? w.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {q ? (
                        <a
                          href={`/quotes/${q.id}`}
                          className="text-amber-400 hover:text-amber-300 font-mono"
                        >
                          {q.quoteNumber ?? q.id.slice(0, 8)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {w.customerId ? customerMap.get(w.customerId) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {v
                        ? `${[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${
                          STATUS_COLORS[w.status] ?? STATUS_COLORS.open
                        }`}
                      >
                        {w.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {w.partsConsumed ? (
                        <span className="text-green-400">Yes</span>
                      ) : (
                        <span className="text-zinc-500">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right">
                      {q ? fmt(q.grandTotal) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {w.quoteId ? (
                        <a
                          href={`/quotes/${w.quoteId}`}
                          className="text-[11px] text-amber-400 hover:text-amber-300 mr-3"
                        >
                          Open quote
                        </a>
                      ) : null}
                      <form action={deleteWO} className="inline">
                        <input type="hidden" name="id" value={w.id} />
                        <button
                          type="submit"
                          className="text-[11px] text-zinc-500 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
