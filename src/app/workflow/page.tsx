import { revalidatePath } from "next/cache";
import { desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { workOrders, quotes, customers, vehicles } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

const STAGES: { key: string; label: string; index: number }[] = [
  { key: "estimate", label: "Estimates", index: 1 },
  { key: "confirmed", label: "Confirmed Builds", index: 2 },
  { key: "awaiting_parts", label: "Awaiting Parts", index: 3 },
  { key: "next_in_line", label: "Next In Line", index: 4 },
  { key: "in_progress", label: "In Progress", index: 5 },
  { key: "qc_check", label: "QC Check", index: 6 },
  { key: "completed", label: "Completed", index: 7 },
  { key: "delivered", label: "Delivered", index: 8 },
];

const WO_STAGES = STAGES.filter((s) => s.key !== "estimate").map((s) => s.key);

async function moveWorkOrder(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!id || !WO_STAGES.includes(stage)) return;
  await db
    .update(workOrders)
    .set({ status: stage, updatedAt: new Date() })
    .where(eq(workOrders.id, id));
  revalidatePath("/workflow");
}

async function promoteEstimate(formData: FormData) {
  "use server";
  const quoteId = String(formData.get("quoteId") ?? "");
  if (!quoteId) return;
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return;
  const woNumber = `WO-${Date.now().toString().slice(-7)}`;
  await db.insert(workOrders).values({
    woNumber,
    customerId: q.customerId ?? null,
    quoteId: q.id,
    status: "confirmed",
  });
  revalidatePath("/workflow");
}

function fmtMoney(v: string | null | undefined) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function WorkflowPage() {
  // Estimates = quotes that are sent/approved AND have no linked work order yet.
  const promotedQuoteIds = await db
    .select({ id: workOrders.quoteId })
    .from(workOrders)
    .where(sql`${workOrders.quoteId} is not null`);
  const promoted = new Set(promotedQuoteIds.map((r) => r.id).filter(Boolean) as string[]);

  const estimateRows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      customerId: quotes.customerId,
      grandTotal: quotes.grandTotal,
      status: quotes.status,
      notes: quotes.notes,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(or(eq(quotes.status, "sent"), eq(quotes.status, "approved")))
    .orderBy(desc(quotes.createdAt));
  const estimates = estimateRows.filter((q) => !promoted.has(q.id));

  // Work orders for the build columns.
  const woRows = await db
    .select({
      id: workOrders.id,
      woNumber: workOrders.woNumber,
      status: workOrders.status,
      customerId: workOrders.customerId,
      vehicleId: workOrders.vehicleId,
      quoteId: workOrders.quoteId,
      notes: workOrders.notes,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    .orderBy(desc(workOrders.createdAt));

  // Fetch customer + vehicle + quote-total lookups in one go.
  const customerIds = Array.from(
    new Set(
      [...estimates, ...woRows]
        .map((r) => ("customerId" in r ? r.customerId : null))
        .filter(Boolean) as string[],
    ),
  );
  const vehicleIds = Array.from(
    new Set(woRows.map((r) => r.vehicleId).filter(Boolean) as string[]),
  );
  const quoteIds = Array.from(
    new Set(woRows.map((r) => r.quoteId).filter(Boolean) as string[]),
  );

  const [customerRows, vehicleRows, quoteTotalsRows] = await Promise.all([
    customerIds.length
      ? db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
      : Promise.resolve([] as { id: string; name: string }[]),
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
      : Promise.resolve([] as { id: string; year: number | null; make: string | null; model: string | null; vin: string | null }[]),
    quoteIds.length
      ? db
          .select({ id: quotes.id, grandTotal: quotes.grandTotal })
          .from(quotes)
          .where(inArray(quotes.id, quoteIds))
      : Promise.resolve([] as { id: string; grandTotal: string | null }[]),
  ]);

  const customerMap = new Map(customerRows.map((r) => [r.id, r.name]));
  const vehicleMap = new Map(vehicleRows.map((r) => [r.id, r]));
  const quoteTotalMap = new Map(quoteTotalsRows.map((r) => [r.id, r.grandTotal]));

  const wosByStage: Record<string, typeof woRows> = {};
  for (const s of WO_STAGES) wosByStage[s] = [];
  for (const wo of woRows) {
    if (wosByStage[wo.status]) wosByStage[wo.status].push(wo);
    else (wosByStage["confirmed"] ||= []).push(wo); // fallback bucket for unknown statuses
  }

  return (
    <AppShell title="Workflow" subtitle="Build pipeline — Estimates through Delivered">
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const items =
            stage.key === "estimate" ? estimates : wosByStage[stage.key] ?? [];
          return (
            <div
              key={stage.key}
              className="min-w-[260px] w-[260px] bg-[#0f0f1a] border border-white/5 rounded-lg flex-shrink-0"
            >
              <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
                <div className="text-[11px] font-body font-semibold text-zinc-300">
                  <span className="text-zinc-500 mr-1">{stage.index}.</span>
                  {stage.label}
                </div>
                <span className="text-[10px] text-zinc-500 bg-white/5 rounded px-1.5 py-0.5">
                  {items.length}
                </span>
              </div>
              <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="text-[11px] text-zinc-600 text-center py-6 font-body">
                    Empty
                  </div>
                ) : stage.key === "estimate" ? (
                  estimates.map((q) => {
                    const customerName = q.customerId
                      ? customerMap.get(q.customerId)
                      : null;
                    return (
                      <div
                        key={q.id}
                        className="bg-[#161624] border border-white/10 rounded-md p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {q.quoteNumber ?? `EST-${q.id.slice(0, 6)}`}
                          </span>
                          <span className="text-[9px] uppercase tracking-wider text-amber-300 bg-amber-500/10 rounded px-1.5">
                            {q.status}
                          </span>
                        </div>
                        <div className="text-xs text-white font-body line-clamp-2">
                          {q.notes ?? "Estimate"}
                        </div>
                        {customerName ? (
                          <div className="text-[11px] text-zinc-400 font-body">
                            {customerName}
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] font-body font-semibold text-green-400">
                            {fmtMoney(q.grandTotal) ?? "—"}
                          </span>
                          <form action={promoteEstimate}>
                            <input type="hidden" name="quoteId" value={q.id} />
                            <button
                              type="submit"
                              className="text-[10px] font-body text-amber-400 hover:text-amber-300"
                            >
                              Promote →
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  (wosByStage[stage.key] ?? []).map((wo) => {
                    const customerName = wo.customerId
                      ? customerMap.get(wo.customerId)
                      : null;
                    const vehicle = wo.vehicleId
                      ? vehicleMap.get(wo.vehicleId)
                      : null;
                    const total = wo.quoteId ? quoteTotalMap.get(wo.quoteId) : null;
                    return (
                      <div
                        key={wo.id}
                        className="bg-[#161624] border border-white/10 rounded-md p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {wo.woNumber ?? `WO-${wo.id.slice(0, 6)}`}
                          </span>
                        </div>
                        <div className="text-xs text-white font-body line-clamp-2">
                          {wo.notes ?? "Work order"}
                        </div>
                        {customerName ? (
                          <div className="text-[11px] text-zinc-400 font-body">
                            {customerName}
                          </div>
                        ) : null}
                        {vehicle ? (
                          <div className="text-[10px] text-zinc-500 font-mono">
                            {[vehicle.year, vehicle.make, vehicle.model]
                              .filter(Boolean)
                              .join(" ")}
                            {vehicle.vin ? ` · ${vehicle.vin}` : ""}
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between pt-1 gap-2">
                          {total ? (
                            <span className="text-[11px] font-body font-semibold text-green-400">
                              {fmtMoney(total)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-zinc-600">—</span>
                          )}
                          <form action={moveWorkOrder} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={wo.id} />
                            <select
                              name="stage"
                              defaultValue={wo.status}
                              className="bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-zinc-300"
                            >
                              {WO_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {STAGES.find((st) => st.key === s)?.label ?? s}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="text-[10px] font-body text-amber-400 hover:text-amber-300"
                            >
                              Move
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
