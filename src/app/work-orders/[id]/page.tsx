import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { workOrders, customers, vehicles, quotes, users, qcChecklists, type QCItem } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";
import { getOrCreateChecklist, setChecklistItems, qcComplete } from "@/lib/qc";
import { resolveWorkOrderParts } from "@/lib/workOrderParts";
import { laborByWorkOrder } from "@/lib/timeclock";
import { DEFAULT_LABOR_RATE_USD_PER_HOUR } from "@/config/labor";

export const dynamic = "force-dynamic";

const PRIORITIES = ["low", "normal", "high", "urgent"];

function inputDate(d: Date | null | undefined): string {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function saveWorkOrder(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const assignedTo = String(formData.get("assignedTo") ?? "") || null;
  const priority = String(formData.get("priority") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const dateRaw = String(formData.get("targetBuildStartDate") ?? "").trim();
  const bufferRaw = String(formData.get("safetyBufferDays") ?? "").trim();
  await db
    .update(workOrders)
    .set({
      assignedTo,
      priority,
      notes,
      targetBuildStartDate: dateRaw ? new Date(dateRaw) : null,
      safetyBufferDays: bufferRaw === "" ? 7 : Math.max(0, Number(bufferRaw) || 0),
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, id));
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/work-orders");
}

async function saveQc(formData: FormData) {
  "use server";
  const session = await auth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [checklist] = await db
    .select({ items: qcChecklists.items })
    .from(qcChecklists)
    .where(eq(qcChecklists.workOrderId, id))
    .orderBy(desc(qcChecklists.createdAt))
    .limit(1);
  const current = (checklist?.items as QCItem[] | null) ?? [];
  const updated: QCItem[] = current.map((item, idx) => ({
    label: item.label,
    passed: formData.get(`qc_${idx}`) === "on",
    notes: String(formData.get(`qcnote_${idx}`) ?? "").trim() || undefined,
  }));
  await setChecklistItems(id, updated, session?.user?.id ?? null);
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/workflow");
}

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return null;

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, id));
  if (!wo) notFound();

  const [customer] = wo.customerId
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, wo.customerId))
    : [undefined];
  const [vehicle] = wo.vehicleId
    ? await db.select().from(vehicles).where(eq(vehicles.id, wo.vehicleId))
    : [undefined];
  const [quote] = wo.quoteId
    ? await db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber }).from(quotes).where(eq(quotes.id, wo.quoteId))
    : [undefined];

  const userRows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.active, true));

  const partLines = await resolveWorkOrderParts(id);
  const checklist = await getOrCreateChecklist(id);
  const items = (checklist.items as QCItem[] | null) ?? [];
  const passed = await qcComplete(id);

  const allLabor = await laborByWorkOrder();
  const labor = allLabor.find((l) => l.workOrderId === id) ?? { hours: 0, laborCost: 0 };

  const vehicleLabel = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.vin || "—"
    : "—";

  return (
    <AppShell
      title={`Work Order ${wo.woNumber ?? wo.id.slice(0, 8)}`}
      subtitle={`Status: ${wo.status.replace(/_/g, " ")}`}
    >
      <div className="flex justify-end mb-4">
        <a
          href={`/api/pdf/work-orders/${wo.id}`}
          target="_blank"
          rel="noopener"
          className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold"
        >
          Work order PDF (no pricing)
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Details + editable fields */}
        <form action={saveWorkOrder} className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
          <input type="hidden" name="id" value={wo.id} />
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Details</h3>

          <div className="grid grid-cols-2 gap-3 text-xs text-zinc-300">
            <div><span className="text-zinc-500">Customer:</span> {customer?.name ?? "—"}</div>
            <div><span className="text-zinc-500">Vehicle:</span> {vehicleLabel}</div>
            <div>
              <span className="text-zinc-500">Estimate:</span>{" "}
              {quote ? (
                <a href={`/quotes/${quote.id}`} className="text-amber-400 hover:text-amber-300 font-mono">
                  {quote.quoteNumber ?? quote.id.slice(0, 8)}
                </a>
              ) : "—"}
            </div>
            <div><span className="text-zinc-500">Created:</span> {fmtDateTime(wo.createdAt)}</div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Assigned to</label>
            <select name="assignedTo" defaultValue={wo.assignedTo ?? ""} className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
              <option value="">— Unassigned —</option>
              {userRows.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">Priority</label>
              <select name="priority" defaultValue={wo.priority ?? "normal"} className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">Target build start</label>
              <input type="date" name="targetBuildStartDate" defaultValue={inputDate(wo.targetBuildStartDate)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Safety buffer (days)</label>
            <input type="number" name="safetyBufferDays" min="0" defaultValue={wo.safetyBufferDays} className="mt-1 w-28 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Notes</label>
            <textarea name="notes" defaultValue={wo.notes ?? ""} rows={3} className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-400">
              Labor: <span className="text-zinc-200">{labor.hours.toFixed(2)} h</span> · <span className="text-amber-300">{money(labor.laborCost)}</span>
              <span className="text-zinc-600"> @ {money(DEFAULT_LABOR_RATE_USD_PER_HOUR)}/h</span>
            </div>
            <button type="submit" className="text-[11px] bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-1.5 font-semibold">Save</button>
          </div>
        </form>

        {/* Parts (de-priced) */}
        <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden h-fit">
          <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-body border-b border-white/5">
            Parts (build sheet — no pricing)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Part #</th>
                <th className="px-3 py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="font-body text-zinc-200">
              {partLines.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-500">No parts on the linked estimate.</td></tr>
              ) : (
                partLines.map((l, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-3 py-2 text-xs text-white">{l.name}</td>
                    <td className="px-3 py-2 text-xs">{l.brand ?? "—"}</td>
                    <td className="px-3 py-2 text-xs font-mono">{l.partNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-right">{l.quantity}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* QC checklist */}
      <form action={saveQc} className="bg-[#161624] border border-white/5 rounded-lg p-4 mt-6 max-w-3xl">
        <input type="hidden" name="id" value={wo.id} />
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">QC checklist</h3>
          <span className={`text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${passed ? "bg-green-500/10 text-green-300 border-green-500/30" : "bg-amber-500/10 text-amber-300 border-amber-500/30"}`}>
            {passed ? "Passed" : "Incomplete"}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500 mb-3">
          A build can&apos;t move into Completed or Delivered until every item passes.
        </p>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-start gap-3 border-t border-white/5 pt-2">
              <input type="checkbox" name={`qc_${idx}`} defaultChecked={item.passed} className="mt-1 accent-green-500" />
              <div className="flex-1">
                <div className="text-sm text-zinc-200">{item.label}</div>
                <input
                  name={`qcnote_${idx}`}
                  defaultValue={item.notes ?? ""}
                  placeholder="Note (optional)"
                  className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-zinc-300 placeholder:text-zinc-600"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-3">
          <button type="submit" className="text-[11px] bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold">Save QC</button>
        </div>
      </form>
    </AppShell>
  );
}
