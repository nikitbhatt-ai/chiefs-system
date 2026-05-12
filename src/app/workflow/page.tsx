import { revalidatePath } from "next/cache";
import { desc, eq, inArray, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  workOrders,
  quotes,
  customers,
  vehicles,
  parts,
  partReceipts,
  deals,
} from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { stageLabel, STAGE_COLORS } from "@/lib/pipelines";
import { syncWorkflowToDeal } from "@/lib/dealTriggers";

type StockLine = {
  kind?: string;
  partId?: string;
  quantity?: number;
};

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
const STAGE_KEYS = STAGES.map((s) => s.key);

async function moveQuoteStage(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!id || !STAGE_KEYS.includes(stage)) return;

  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) return;

  let [wo] = await db.select().from(workOrders).where(eq(workOrders.quoteId, id));
  const prevWorkflowStage = wo?.status ?? null;
  if (!wo && stage !== "estimate") {
    const woNumber = `WO-${Date.now().toString().slice(-7)}`;
    const inserted = await db
      .insert(workOrders)
      .values({
        woNumber,
        customerId: q.customerId ?? null,
        quoteId: id,
        dealId: q.dealId ?? null,
        status: stage,
      })
      .returning();
    wo = inserted[0];
  } else if (wo) {
    if (!wo.dealId && q.dealId) {
      await db.update(workOrders).set({ dealId: q.dealId, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
      wo = { ...wo, dealId: q.dealId };
    }
    await db
      .update(workOrders)
      .set({ status: stage, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
  }

  if (stage === "in_progress" && wo && !wo.partsConsumed) {
    const lines = (q.lineItems as unknown as StockLine[]) ?? [];
    for (const line of lines) {
      if (line.kind !== "item" || !line.partId) continue;
      const qty = Number(line.quantity || 0);
      if (qty <= 0) continue;
      const layers = await db
        .select()
        .from(partReceipts)
        .where(eq(partReceipts.partId, line.partId))
        .orderBy(asc(partReceipts.receivedAt));
      let need = qty;
      for (const layer of layers) {
        if (need <= 0) break;
        if (layer.quantityRemaining <= 0) continue;
        const take = Math.min(need, layer.quantityRemaining);
        await db
          .update(partReceipts)
          .set({ quantityRemaining: layer.quantityRemaining - take })
          .where(eq(partReceipts.id, layer.id));
        need -= take;
      }
      await db
        .update(parts)
        .set({
          quantityOnHand: sql`${parts.quantityOnHand} - ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, line.partId));
    }
    await db
      .update(workOrders)
      .set({ partsConsumed: true, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
  }

  await db
    .update(quotes)
    .set({ workflowStage: stage, updatedAt: new Date() })
    .where(eq(quotes.id, id));

  if (wo?.id) {
    await syncWorkflowToDeal(wo.id, stage, prevWorkflowStage);
  }

  revalidatePath("/workflow");
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/inventory");
  revalidatePath("/work-orders");
  if (wo?.dealId) revalidatePath(`/deals/${wo.dealId}`);
}

function fmtMoney(v: string | null | undefined) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function WorkflowPage() {
  const quoteRows = await db.select().from(quotes).orderBy(desc(quotes.createdAt));

  const customerIds = Array.from(
    new Set(quoteRows.map((r) => r.customerId).filter(Boolean) as string[]),
  );

  const linkedWOs = await db
    .select({
      id: workOrders.id,
      quoteId: workOrders.quoteId,
      vehicleId: workOrders.vehicleId,
    })
    .from(workOrders);
  const woByQuote = new Map(
    linkedWOs.filter((w) => w.quoteId).map((w) => [w.quoteId as string, w]),
  );
  const vehicleIds = Array.from(
    new Set(linkedWOs.map((w) => w.vehicleId).filter(Boolean) as string[]),
  );

  const dealIds = Array.from(new Set(quoteRows.map((r) => r.dealId).filter(Boolean) as string[]));
  const dealRows = dealIds.length
    ? await db.select({ id: deals.id, stage: deals.stage }).from(deals).where(inArray(deals.id, dealIds))
    : [];
  const dealMap = new Map(dealRows.map((d) => [d.id, d.stage]));

  const [customerRows, vehicleRows] = await Promise.all([
    customerIds.length
      ? db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(inArray(customers.id, customerIds))
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
  const vehicleMap = new Map(vehicleRows.map((r) => [r.id, r]));

  const byStage: Record<string, typeof quoteRows> = {};
  for (const s of STAGE_KEYS) byStage[s] = [];
  for (const q of quoteRows) {
    const key = STAGE_KEYS.includes(q.workflowStage) ? q.workflowStage : "estimate";
    byStage[key].push(q);
  }

  return (
    <AppShell title="Workflow" subtitle="Build pipeline — every quote, by stage">
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const items = byStage[stage.key] ?? [];
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
                ) : (
                  items.map((q) => {
                    const customerName = q.customerId
                      ? customerMap.get(q.customerId)
                      : null;
                    const wo = woByQuote.get(q.id);
                    const vehicle = wo?.vehicleId
                      ? vehicleMap.get(wo.vehicleId)
                      : null;
                    return (
                      <div
                        key={q.id}
                        className="bg-[#161624] border border-white/10 rounded-md p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <a
                            href={`/quotes/${q.id}`}
                            className="text-[10px] font-mono text-amber-400 hover:text-amber-300"
                          >
                            {q.quoteNumber ?? `Q-${q.id.slice(0, 6)}`}
                          </a>
                          <span className="text-[9px] uppercase tracking-wider text-zinc-400 bg-white/5 rounded px-1.5">
                            {q.status}
                          </span>
                        </div>
                        <div className="text-xs text-white font-body line-clamp-2">
                          {q.notes ?? "Quote"}
                        </div>
                        {customerName ? (
                          <div className="text-[11px] text-zinc-400 font-body">
                            {customerName}
                          </div>
                        ) : null}
                        {q.dealId && dealMap.has(q.dealId) ? (
                          <a
                            href={`/deals/${q.dealId}`}
                            className={`inline-block text-[9px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${STAGE_COLORS[dealMap.get(q.dealId)!] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"} hover:opacity-80`}
                            title="CRM stage — click to open deal"
                          >
                            CRM · {stageLabel(dealMap.get(q.dealId)!)}
                          </a>
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
                          <span className="text-[11px] font-body font-semibold text-green-400">
                            {fmtMoney(q.grandTotal) ?? "—"}
                          </span>
                          <form action={moveQuoteStage} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={q.id} />
                            <select
                              name="stage"
                              defaultValue={q.workflowStage}
                              className="bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-zinc-300"
                            >
                              {STAGES.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
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
