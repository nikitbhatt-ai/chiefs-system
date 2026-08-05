import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { fmtCents } from "@/lib/accounting";
import {
  inventoryReconciliation,
  inventoryValuationByPart,
  postInventoryAdjustment,
} from "@/lib/inventoryValuation";
import { setCostingMethod, type CostingMethod } from "@/lib/costing";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  weighted_average: "Weighted average",
  fifo: "FIFO",
};

export default async function InventoryAccountingPage() {
  const [recon, byPart] = await Promise.all([inventoryReconciliation(), inventoryValuationByPart()]);
  const activeLabel = METHOD_LABEL[recon.method] ?? recon.method;
  const otherLabel = recon.method === "fifo" ? "Weighted average" : "FIFO";
  const otherCents = recon.method === "fifo" ? recon.avgCents : recon.fifoCents;

  async function adjust() {
    "use server";
    const session = await auth();
    await postInventoryAdjustment(session?.user?.id ?? null);
    revalidatePath("/accounting/inventory");
    revalidatePath("/accounting");
  }

  async function switchMethod(formData: FormData) {
    "use server";
    const method = String(formData.get("method")) as CostingMethod;
    if (method !== "weighted_average" && method !== "fifo") return;
    const session = await auth();
    await setCostingMethod(method, session?.user?.id ?? null);
    revalidatePath("/accounting/inventory");
  }

  return (
    <AppShell title="Inventory accounting" subtitle={`${activeLabel} subledger reconciled to the Inventory ledger account (1200)`}>
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/inventory" className="text-xs text-amber-400 hover:text-amber-300 font-body">Inventory list →</Link>
        <span className="text-[11px] text-zinc-500 font-body ml-auto">Costing method:</span>
        <form action={switchMethod} className="flex items-center gap-1.5">
          {(["weighted_average", "fifo"] as const).map((m) => (
            <button
              key={m}
              type="submit"
              name="method"
              value={m}
              className={`text-[11px] font-body rounded-md px-2.5 py-1 border transition-colors ${
                recon.method === m
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300 font-semibold"
                  : "border-white/10 text-zinc-400 hover:text-white"
              }`}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </form>
      </div>
      <p className="text-[11px] text-zinc-500 font-body -mt-2">
        Switching applies forward only — it re-values on-hand and future job costs; it never rewrites posted entries.
      </p>

      <div
        className={`rounded-lg border px-4 py-3 font-body text-sm ${
          recon.ties
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
        }`}
      >
        {recon.ties ? (
          <>
            <span className="font-semibold">Inventory reconciles.</span>{" "}
            {activeLabel} subledger {fmtCents(recon.subledgerCents)} = Inventory ledger {fmtCents(recon.glBalanceCents)}.
          </>
        ) : (
          <>
            <span className="font-semibold">Out of sync by {fmtCents(Math.abs(recon.differenceCents))}.</span>{" "}
            {activeLabel} subledger {fmtCents(recon.subledgerCents)} vs Inventory ledger {fmtCents(recon.glBalanceCents)}.{" "}
            This is expected the first time — stock that existed before accounting went live hasn&apos;t been booked to
            the ledger yet. Post the adjustment below to bring the ledger in line (offsets to Owner&apos;s Equity).
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface border border-white/5 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">{activeLabel} subledger (active)</div>
          <div className="text-white font-display font-semibold text-lg mt-1">{fmtCents(recon.subledgerCents)}</div>
          <div className="text-[10px] text-zinc-500 font-body mt-1">{otherLabel} comparison: {fmtCents(otherCents)}</div>
        </div>
        <div className="bg-surface border border-white/5 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Inventory ledger (1200)</div>
          <div className="text-white font-display font-semibold text-lg mt-1">{fmtCents(recon.glBalanceCents)}</div>
        </div>
        <div className="bg-surface border border-white/5 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Difference</div>
          <div className={`font-display font-semibold text-lg mt-1 ${recon.ties ? "text-emerald-400" : "text-amber-300"}`}>
            {fmtCents(recon.differenceCents)}
          </div>
        </div>
      </div>

      {!recon.ties && (
        <form action={adjust}>
          <button
            type="submit"
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
          >
            Post reconciliation adjustment ({fmtCents(recon.differenceCents)})
          </button>
        </form>
      )}

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          On-hand valuation by part ({byPart.length})
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Part</th>
              <th className="px-4 py-2.5 text-right">On hand</th>
              <th className="px-4 py-2.5 text-right">Layer qty</th>
              <th className="px-4 py-2.5 text-right">FIFO value</th>
              <th className="px-4 py-2.5 text-right">Avg value</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {byPart.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No inventory on hand.
                </td>
              </tr>
            ) : (
              byPart.map((p) => (
                <tr key={p.partId} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{p.sku}</td>
                  <td className="px-4 py-2.5 text-xs text-white">{p.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{p.quantityOnHand}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{p.layerQty}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-300">{fmtCents(p.fifoValueCents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(p.avgValueCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Receiving parts posts Dr Inventory / Cr Accounts Payable and rolls each part&apos;s moving average; issuing parts
        to a build posts Dr Work in Progress / Cr Inventory at the active costing method ({activeLabel}), and Phase 5
        moves WIP → COGS when the job closes. Cost layers stay the quantity + provenance subledger under either method;
        the two valuations agree whenever a SKU fully turns over.
      </p>
    </AppShell>
  );
}
