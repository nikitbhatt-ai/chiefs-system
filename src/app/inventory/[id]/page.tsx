import { notFound } from "next/navigation";
import { eq, desc, asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { parts, partReceipts, vendors, purchaseOrders } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { reservedForPart } from "@/lib/reservations";

function fmt(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function PartDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [p] = await db.select().from(parts).where(eq(parts.id, id));
  if (!p) notFound();

  // Available-to-pull = on-hand − active reservations (Phase 5).
  const reserved = await reservedForPart(id);
  const available = p.quantityOnHand - reserved;

  // Active FIFO layers: any receipt with quantityRemaining > 0, oldest first.
  const allReceipts = await db
    .select()
    .from(partReceipts)
    .where(eq(partReceipts.partId, id))
    .orderBy(asc(partReceipts.receivedAt));

  const activeLayers = allReceipts.filter((r) => r.quantityRemaining > 0);

  // Weighted average across remaining stock (this is what your inventory is
  // actually worth right now per FIFO depletion).
  let totalQty = 0;
  let totalValue = 0;
  for (const r of activeLayers) {
    totalQty += r.quantityRemaining;
    totalValue += r.quantityRemaining * Number(r.unitCost);
  }
  const weightedAvg = totalQty > 0 ? totalValue / totalQty : null;

  // Lifetime weighted average (across all received qty, ignoring depletion).
  let lifetimeQty = 0;
  let lifetimeValue = 0;
  for (const r of allReceipts) {
    lifetimeQty += r.quantityReceived;
    lifetimeValue += r.quantityReceived * Number(r.unitCost);
  }
  const lifetimeAvg = lifetimeQty > 0 ? lifetimeValue / lifetimeQty : null;

  const last = allReceipts[allReceipts.length - 1];

  // Vendor + PO names for the history table.
  const vendorIds = Array.from(
    new Set(allReceipts.map((r) => r.vendorId).filter(Boolean) as string[]),
  );
  const poIds = Array.from(
    new Set(allReceipts.map((r) => r.purchaseOrderId).filter(Boolean) as string[]),
  );
  const [vendorRows, poRows] = await Promise.all([
    vendorIds.length
      ? db
          .select({ id: vendors.id, name: vendors.name })
          .from(vendors)
          .where(inArray(vendors.id, vendorIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    poIds.length
      ? db
          .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
          .from(purchaseOrders)
          .where(inArray(purchaseOrders.id, poIds))
      : Promise.resolve([] as { id: string; poNumber: string | null }[]),
  ]);
  const vMap = new Map(vendorRows.map((v) => [v.id, v.name]));
  const poMap = new Map(poRows.map((r) => [r.id, r.poNumber]));

  // Sample FIFO consumption for a few quantities, to illustrate cost.
  function fifoCost(qty: number) {
    let need = qty;
    let cost = 0;
    for (const r of activeLayers) {
      if (need <= 0) break;
      const take = Math.min(need, r.quantityRemaining);
      cost += take * Number(r.unitCost);
      need -= take;
    }
    if (need > 0) return null; // not enough on hand
    return cost;
  }
  const samples = [1, 5, 10, 25].filter((q) => q <= totalQty);

  return (
    <AppShell title={`${p.sku}`} subtitle={p.name}>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="On hand" value={p.quantityOnHand.toString()} />
        <Stat
          label="Reserved"
          value={reserved.toString()}
          hint="Claimed by committed builds"
        />
        <Stat
          label="Available"
          value={available.toString()}
          hint="On hand − reserved (what pulls draw from)"
          highlight
        />
        <Stat label="On order" value={p.quantityOnOrder.toString()} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="Average cost" value={p.avgCost ? fmt(p.avgCost) : p.cost ? fmt(p.cost) : "—"} hint="Weighted average" />
        <Stat label="Stored cost" value={p.cost ? fmt(p.cost) : "—"} hint="parts.cost (= avg, 2dp)" />
        <Stat label="Price" value={p.price ? fmt(p.price) : "—"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat
          label="Weighted avg cost (active)"
          value={weightedAvg != null ? fmt(weightedAvg) : "—"}
          hint="Across remaining FIFO layers"
          highlight
        />
        <Stat
          label="Lifetime avg cost"
          value={lifetimeAvg != null ? fmt(lifetimeAvg) : "—"}
          hint="Across all receipts ever"
        />
        <Stat
          label="Last received"
          value={last ? fmt(last.unitCost) : "—"}
          hint={
            last
              ? `${new Date(last.receivedAt).toLocaleDateString()} · qty ${last.quantityReceived}`
              : "No receipts"
          }
        />
      </div>

      {samples.length > 0 ? (
        <div className="bg-surface border border-white/5 rounded-lg p-4">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
            FIFO cost preview
          </h3>
          <div className="flex flex-wrap gap-3 text-xs font-body text-zinc-300">
            {samples.map((q) => (
              <div
                key={q}
                className="border border-white/10 rounded-md px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Cost of {q} unit{q === 1 ? "" : "s"} (FIFO)
                </div>
                <div className="text-white font-semibold mt-0.5">
                  {fmt(fifoCost(q))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-white/5">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
            FIFO layers (oldest first)
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">PO</th>
              <th className="px-3 py-2 text-right">Qty received</th>
              <th className="px-3 py-2 text-right">Qty remaining</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">Layer value</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {allReceipts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No receipts yet. Receive a PO that includes this part to populate cost layers.
                </td>
              </tr>
            ) : (
              allReceipts.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-white/5 ${
                    r.quantityRemaining === 0 ? "opacity-40" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-xs">
                    {new Date(r.receivedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.vendorId ? vMap.get(r.vendorId) ?? "—" : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {r.purchaseOrderId ? poMap.get(r.purchaseOrderId) ?? "—" : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-right">{r.quantityReceived}</td>
                  <td className="px-3 py-2 text-xs text-right">{r.quantityRemaining}</td>
                  <td className="px-3 py-2 text-xs text-right">{fmt(r.unitCost)}</td>
                  <td className="px-3 py-2 text-xs text-right">
                    {fmt(r.quantityRemaining * Number(r.unitCost))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <a
          href={`/inventory/${p.id}/edit`}
          className="text-xs font-body text-amber-400 hover:text-amber-300 border border-white/10 rounded-md px-4 py-2"
        >
          Edit part
        </a>
        <a
          href="/inventory"
          className="text-xs font-body text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2"
        >
          Back to inventory
        </a>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-surface border rounded-lg p-3 ${
        highlight ? "border-amber-500/30" : "border-white/5"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
        {label}
      </div>
      <div
        className={`mt-1 font-display font-bold ${
          highlight ? "text-amber-300 text-2xl" : "text-white text-xl"
        }`}
      >
        {value}
      </div>
      {hint ? (
        <div className="text-[10px] text-zinc-500 font-body mt-0.5">{hint}</div>
      ) : null}
    </div>
  );
}
