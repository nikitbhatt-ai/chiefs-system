import { desc, inArray, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  workOrders,
  customers,
  quotes,
  parts,
  purchaseOrders,
  vendors,
  type POLineItem,
} from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import {
  buildPartPlan,
  partOrderedQuantities,
  poLinesAsRefs,
  requiredPartQuantities,
  sortPlan,
  type PartPlanRow,
  type PartRef,
  type QuoteLine,
} from "@/lib/procurement";

export const dynamic = "force-dynamic";

// Stages that count as "active build pipeline" — we want parts for these
// surfaced. Delivered / archived WOs are skipped because they're either
// done or dead.
const ACTIVE_STATUSES = ["estimate", "confirmed", "awaiting_parts", "next_in_line", "in_progress", "qc_check"];

export default async function PartsToOrderPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const woRows = await db
    .select()
    .from(workOrders)
    .where(inArray(workOrders.status, ACTIVE_STATUSES))
    .orderBy(desc(workOrders.createdAt));

  const quoteIds = Array.from(new Set(woRows.map((w) => w.quoteId).filter(Boolean) as string[]));
  const customerIds = Array.from(new Set(woRows.map((w) => w.customerId).filter(Boolean) as string[]));

  const [quoteRows, customerRows] = await Promise.all([
    quoteIds.length
      ? db
          .select({
            id: quotes.id,
            quoteNumber: quotes.quoteNumber,
            lineItems: quotes.lineItems,
          })
          .from(quotes)
          .where(inArray(quotes.id, quoteIds))
      : Promise.resolve([] as { id: string; quoteNumber: string | null; lineItems: unknown }[]),
    customerIds.length
      ? db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const quoteMap = new Map(quoteRows.map((r) => [r.id, r]));
  const customerMap = new Map(customerRows.map((r) => [r.id, r.name]));

  // All part_ids across the active WOs
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
      .select({ status: purchaseOrders.status, lineItems: purchaseOrders.lineItems })
      .from(purchaseOrders)
      .where(ne(purchaseOrders.status, "received")),
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

  const openLines: { partId?: string | null; quantity: number }[] = [];
  for (const po of openPORows) {
    const lines = (po.lineItems as POLineItem[] | null | undefined) ?? [];
    for (const li of poLinesAsRefs(lines)) openLines.push(li);
  }
  const openByPart = partOrderedQuantities(openLines);

  // Flatten: every (WO × part) row, filtered to overdue or at-risk only.
  type Row = PartPlanRow & {
    woId: string;
    woNumber: string | null;
    quoteNumber: string | null;
    customerName: string;
    targetBuildStartDate: Date | null;
  };
  const flat: Row[] = [];
  for (const w of woRows) {
    if (!w.quoteId) continue;
    const q = quoteMap.get(w.quoteId);
    if (!q) continue;
    const lines = (q.lineItems as QuoteLine[] | null | undefined) ?? [];
    const required = requiredPartQuantities(lines);
    if (required.size === 0) continue;
    const plan = sortPlan(
      buildPartPlan(required, partsById, openByPart, w.targetBuildStartDate, w.safetyBufferDays),
    );
    for (const p of plan) {
      if (p.status !== "overdue" && p.status !== "at_risk") continue;
      flat.push({
        ...p,
        woId: w.id,
        woNumber: w.woNumber,
        quoteNumber: q.quoteNumber,
        customerName: w.customerId ? customerMap.get(w.customerId) ?? "—" : "—",
        targetBuildStartDate: w.targetBuildStartDate,
      });
    }
  }
  flat.sort((a, b) => {
    const ra = a.status === "overdue" ? 0 : 1;
    const rb = b.status === "overdue" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (a.daysUntilLatestOrder ?? 0) - (b.daysUntilLatestOrder ?? 0);
  });

  function fmtDate(d: Date | null): string {
    if (!d) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const overdueCount = flat.filter((r) => r.status === "overdue").length;

  return (
    <AppShell title="Parts to order now" subtitle={`${flat.length} parts across ${new Set(flat.map((f) => f.woId)).size} work orders · ${overdueCount} overdue`}>
      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        {flat.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 font-body">
            Nothing is at risk right now. Either every required part is ordered or no active work order has a target build start date set yet.
            {' '}<a className="text-amber-400 underline" href="/work-orders">Set target build start dates →</a>
          </div>
        ) : (
          <table className="w-full text-xs font-body">
            <thead className="bg-white/5">
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Lead time</th>
                <th className="px-3 py-2">Latest order by</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2">Work order</th>
                <th className="px-3 py-2">Customer</th>
              </tr>
            </thead>
            <tbody>
              {flat.map((r) => (
                <tr key={`${r.woId}:${r.partId}`} className="border-t border-white/5">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${
                        r.status === "overdue"
                          ? "bg-red-500/10 text-red-300 border-red-500/30"
                          : "bg-amber-500/10 text-amber-300 border-amber-500/30"
                      }`}
                    >
                      {r.status === "overdue" ? "Overdue" : "At risk"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-white">
                    <a href={`/inventory/${r.partId}`} className="hover:text-amber-300">
                      {r.sku ? <span className="font-mono text-[10px] text-zinc-400 mr-1.5">{r.sku}</span> : null}
                      {r.name}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{r.vendorName ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-zinc-200">{r.quantity}{r.orderedQuantity > 0 && (<span className="text-[10px] text-green-400 ml-1">({r.orderedQuantity} ord)</span>)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.leadTimeDays}d</td>
                  <td className="px-3 py-2 text-zinc-300">{fmtDate(r.latestOrderDate)}</td>
                  <td className={`px-3 py-2 text-right ${r.status === "overdue" ? "text-red-300" : "text-amber-300"}`}>
                    {r.daysUntilLatestOrder == null ? "—" : Math.round(r.daysUntilLatestOrder)}
                  </td>
                  <td className="px-3 py-2 text-amber-400">
                    <a href="/work-orders" className="hover:text-amber-300 font-mono text-[11px]">
                      {r.woNumber ?? r.woId.slice(0, 8)}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{r.customerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
