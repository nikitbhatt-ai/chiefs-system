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

export const dynamic = "force-dynamic";

export default async function InventoryAccountingPage() {
  const [recon, byPart] = await Promise.all([inventoryReconciliation(), inventoryValuationByPart()]);

  async function adjust() {
    "use server";
    const session = await auth();
    await postInventoryAdjustment(session?.user?.id ?? null);
    revalidatePath("/accounting/inventory");
    revalidatePath("/accounting");
  }

  return (
    <AppShell title="Inventory accounting" subtitle="FIFO subledger reconciled to the Inventory ledger account (1200)">
      <div className="flex items-center gap-3">
        <Link href="/accounting" className="text-xs text-amber-400 hover:text-amber-300 font-body">← Accounting</Link>
        <Link href="/inventory" className="text-xs text-amber-400 hover:text-amber-300 font-body">Inventory list →</Link>
      </div>

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
            FIFO subledger {fmtCents(recon.subledgerCents)} = Inventory ledger {fmtCents(recon.glBalanceCents)}.
          </>
        ) : (
          <>
            <span className="font-semibold">Out of sync by {fmtCents(Math.abs(recon.differenceCents))}.</span>{" "}
            FIFO subledger {fmtCents(recon.subledgerCents)} vs Inventory ledger {fmtCents(recon.glBalanceCents)}.{" "}
            This is expected the first time — stock that existed before accounting went live hasn&apos;t been booked to
            the ledger yet. Post the adjustment below to bring the ledger in line (offsets to Owner&apos;s Equity).
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#161624] border border-white/5 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">FIFO subledger (on-hand value)</div>
          <div className="text-white font-display font-semibold text-lg mt-1">{fmtCents(recon.subledgerCents)}</div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">Inventory ledger (1200)</div>
          <div className="text-white font-display font-semibold text-lg mt-1">{fmtCents(recon.glBalanceCents)}</div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-5">
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

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          On-hand valuation by part ({byPart.length})
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Part</th>
              <th className="px-4 py-2.5 text-right">On hand</th>
              <th className="px-4 py-2.5 text-right">FIFO layers</th>
              <th className="px-4 py-2.5 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {byPart.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No inventory on hand with FIFO cost layers.
                </td>
              </tr>
            ) : (
              byPart.map((p) => (
                <tr key={p.partId} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{p.sku}</td>
                  <td className="px-4 py-2.5 text-xs text-white">{p.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{p.quantityOnHand}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{p.layerQty}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-white">{fmtCents(p.valueCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Receiving parts posts Dr Inventory / Cr Accounts Payable; issuing parts to a build posts Dr Work in Progress /
        Cr Inventory at FIFO cost (Phase 5 moves WIP → COGS when the job closes). The subledger above is valued from the
        remaining FIFO layers, so it always equals the sum of what was received minus what was issued.
      </p>
    </AppShell>
  );
}
