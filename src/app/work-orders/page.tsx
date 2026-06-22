import { revalidatePath } from "next/cache";
import { desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import { db } from "@/db";
import { workOrders, customers, quotes, vehicles, parts, purchaseOrders, vendors, type POLineItem } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";
import {
  buildPartPlan,
  criticalPathForPlan,
  partOrderedQuantities,
  poLinesAsRefs,
  requiredPartQuantities,
  sortPlan,
  type PartRef,
  type QuoteLine,
} from "@/lib/procurement";

export const dynamic = "force-dynamic";

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
  const session = await auth();
  if (!canDelete(session)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(workOrders).where(eq(workOrders.id, id));
  revalidatePath("/work-orders");
  revalidatePath("/workflow");
}

async function setProcurementPlan(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const dateRaw = String(formData.get("targetBuildStartDate") ?? "").trim();
  const bufferRaw = String(formData.get("safetyBufferDays") ?? "").trim();
  const targetBuildStartDate = dateRaw ? new Date(dateRaw) : null;
  const safetyBufferDays = bufferRaw === "" ? 7 : Math.max(0, Number(bufferRaw) || 0);
  await db
    .update(workOrders)
    .set({ targetBuildStartDate, safetyBufferDays, updatedAt: new Date() })
    .where(eq(workOrders.id, id));
  revalidatePath("/work-orders");
  revalidatePath("/procurement/parts-to-order");
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
            lineItems: quotes.lineItems,
          })
          .from(quotes)
          .where(inArray(quotes.id, quoteIds))
      : Promise.resolve([] as { id: string; quoteNumber: string | null; grandTotal: string | null; lineItems: unknown }[]),
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

  // Procurement plan inputs. Gather every part_id mentioned across all the
  // quotes we just loaded, fetch them in a single query with vendor name,
  // and fetch every open PO so we can subtract already-ordered quantities
  // from what each WO still needs.
  const partIds = new Set<string>();
  for (const q of quoteRows) {
    const lines = (q.lineItems as QuoteLine[] | null | undefined) ?? [];
    for (const li of lines) if (li.partId) partIds.add(li.partId);
  }
  const [partRows, openPORows] = await Promise.all([
    partIds.size
      ? db
          .select({
            id: parts.id,
            sku: parts.sku,
            name: parts.name,
            leadTimeDays: parts.leadTimeDays,
            vendorId: parts.vendorId,
          })
          .from(parts)
          .where(inArray(parts.id, Array.from(partIds)))
      : Promise.resolve([] as { id: string; sku: string | null; name: string; leadTimeDays: number; vendorId: string | null }[]),
    db
      .select({ status: purchaseOrders.status, lineItems: purchaseOrders.lineItems, vendorId: purchaseOrders.vendorId })
      .from(purchaseOrders),
  ]);
  const partVendorIds = Array.from(new Set(partRows.map((p) => p.vendorId).filter(Boolean) as string[]));
  const vendorMap = new Map<string, string>();
  if (partVendorIds.length) {
    const vRows = await db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(inArray(vendors.id, partVendorIds));
    for (const v of vRows) vendorMap.set(v.id, v.name);
  }
  const partsById = new Map<string, PartRef>(
    partRows.map((p) => [
      p.id,
      {
        id: p.id,
        sku: p.sku,
        name: p.name,
        leadTimeDays: p.leadTimeDays,
        vendorId: p.vendorId,
        vendorName: p.vendorId ? vendorMap.get(p.vendorId) ?? null : null,
      },
    ]),
  );
  // Aggregate open PO line items by part_id for cross-WO subtraction.
  const openLines: { partId?: string | null; quantity: number }[] = [];
  for (const po of openPORows) {
    if (po.status === "received") continue;
    const lines = (po.lineItems as POLineItem[] | null | undefined) ?? [];
    for (const li of poLinesAsRefs(lines)) openLines.push(li);
  }
  const openByPart = partOrderedQuantities(openLines);

  function planForWO(w: (typeof rows)[number]) {
    if (!w.quoteId) return null;
    const q = quoteMap.get(w.quoteId);
    if (!q) return null;
    const lines = (q.lineItems as QuoteLine[] | null | undefined) ?? [];
    const required = requiredPartQuantities(lines);
    if (required.size === 0) return null;
    const rows = sortPlan(buildPartPlan(required, partsById, openByPart, w.targetBuildStartDate, w.safetyBufferDays));
    const critical = criticalPathForPlan(rows);
    const counts = {
      overdue: rows.filter((r) => r.status === "overdue").length,
      atRisk: rows.filter((r) => r.status === "at_risk").length,
      ordered: rows.filter((r) => r.status === "ordered").length,
      total: rows.length,
    };
    return { rows, critical, counts };
  }

  function inputDate(d: Date | null | undefined): string {
    if (!d) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

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
              <th className="px-3 py-2.5">Procurement</th>
              <th className="px-3 py-2.5">Target start</th>
              <th className="px-3 py-2.5">Parts consumed</th>
              <th className="px-3 py-2.5 text-right">Quote total</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-xs text-zinc-500">
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
                    <td className="px-3 py-2 font-mono text-xs">
                      <a href={`/work-orders/${w.id}`} className="text-white hover:text-amber-300">
                        {w.woNumber ?? w.id.slice(0, 8)}
                      </a>
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
                    <td className="px-3 py-2 text-[11px] font-body">
                      {(() => {
                        const plan = planForWO(w);
                        if (!plan) return <span className="text-zinc-600">no quote</span>;
                        const { counts, critical } = plan;
                        return (
                          <div className="space-y-0.5">
                            <div className="flex gap-1.5 items-center flex-wrap">
                              {counts.overdue > 0 && (
                                <span className="text-[10px] uppercase rounded border px-1.5 py-0.5 bg-red-500/10 text-red-300 border-red-500/30">
                                  {counts.overdue} overdue
                                </span>
                              )}
                              {counts.atRisk > 0 && (
                                <span className="text-[10px] uppercase rounded border px-1.5 py-0.5 bg-amber-500/10 text-amber-300 border-amber-500/30">
                                  {counts.atRisk} at risk
                                </span>
                              )}
                              {counts.ordered > 0 && (
                                <span className="text-[10px] uppercase rounded border px-1.5 py-0.5 bg-green-500/10 text-green-300 border-green-500/30">
                                  {counts.ordered} ordered
                                </span>
                              )}
                              {counts.overdue === 0 && counts.atRisk === 0 && counts.ordered === 0 && (
                                <span className="text-zinc-500">no parts</span>
                              )}
                            </div>
                            {critical.longestLeadDays > 0 && (
                              <div className="text-[10px] text-zinc-500" title="Critical-path part (longest lead time)">
                                ⚠ critical: {critical.longestLeadName} ({critical.longestLeadDays}d)
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <form action={setProcurementPlan} className="flex flex-col gap-1 items-start">
                        <input type="hidden" name="id" value={w.id} />
                        <input
                          type="date"
                          name="targetBuildStartDate"
                          defaultValue={inputDate(w.targetBuildStartDate)}
                          className="bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white w-32"
                        />
                        <div className="flex gap-1 items-center">
                          <input
                            type="number"
                            name="safetyBufferDays"
                            min="0"
                            defaultValue={w.safetyBufferDays}
                            className="bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white w-14"
                          />
                          <span className="text-[10px] text-zinc-500">d buffer</span>
                          <button type="submit" className="text-[10px] text-amber-400 hover:text-amber-300 ml-1">save</button>
                        </div>
                      </form>
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
                    <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(w.createdAt)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <a
                        href={`/api/pdf/work-orders/${w.id}`}
                        target="_blank"
                        rel="noopener"
                        className="text-[11px] text-amber-400 hover:text-amber-300 mr-3"
                        title="Build sheet — no pricing"
                      >
                        WO PDF
                      </a>
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
