import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppShell } from "@/components/AppShell";
import { auth } from "@/auth";
import {
  listReorderPoints,
  listRequisitions,
  scanAllReorderPoints,
  createPOFromRequisition,
  setRequisitionStatus,
} from "@/lib/backfill";
import { BackfillControls } from "./BackfillControls";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  reorder_point: "Reorder point",
  reserved_override: "Reserved override",
};
const STATUS_COLORS: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-300",
  ordered: "bg-blue-500/15 text-blue-300",
  received: "bg-emerald-500/15 text-emerald-300",
};

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString();
}

export default async function BackfillPage() {
  const [reorderPoints, requisitions] = await Promise.all([listReorderPoints(), listRequisitions()]);

  async function scan() {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    await scanAllReorderPoints();
    revalidatePath("/backfill");
  }

  async function makePO(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const { purchaseOrderId } = await createPOFromRequisition(String(formData.get("id")));
    revalidatePath("/backfill");
    redirect(`/purchase-orders/${purchaseOrderId}`);
  }

  async function markReceived(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    await setRequisitionStatus(String(formData.get("id")), "received");
    revalidatePath("/backfill");
  }

  return (
    <AppShell title="Backfill & reorder" subtitle="Replenish before you're squeezed; every reserved-stock borrow replaces itself">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/purchase-orders" className="text-xs text-amber-400 hover:text-amber-300 font-body">Purchase orders →</Link>
        <Link href="/inventory" className="text-xs text-amber-400 hover:text-amber-300 font-body">Inventory →</Link>
        <form action={scan} className="ml-auto">
          <SubmitButton className="text-[11px] font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-1.5">
            Scan reorder points now
          </SubmitButton>
        </form>
      </div>

      <BackfillControls />

      {/* Requisitions */}
      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          Backfill requisitions ({requisitions.length})
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Part</th>
              <th className="px-4 py-2.5 text-right">Qty</th>
              <th className="px-4 py-2.5">Trigger</th>
              <th className="px-4 py-2.5">Need by</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">PO</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {requisitions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No backfill requisitions. They appear when a reorder point fires or reserved stock is pulled.
                </td>
              </tr>
            ) : (
              requisitions.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">{r.sku ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-white">{r.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right text-xs">{r.qty}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{TRIGGER_LABEL[r.triggeredBy] ?? r.triggeredBy}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{fmtDate(r.needBy)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_COLORS[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.purchaseOrderId ? (
                      <Link href={`/purchase-orders/${r.purchaseOrderId}`} className="font-mono text-amber-400 hover:text-amber-300">
                        {r.poNumber ?? "PO"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {r.status === "open" ? (
                      <form action={makePO} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="text-[11px] text-amber-400 hover:text-amber-300 px-1.5">Create PO</SubmitButton>
                      </form>
                    ) : null}
                    {r.status === "ordered" ? (
                      <form action={markReceived} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="text-[11px] text-zinc-400 hover:text-white px-1.5">Mark received</SubmitButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Reorder points */}
      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          Reorder points ({reorderPoints.length})
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Part</th>
              <th className="px-4 py-2.5 text-right">On hand</th>
              <th className="px-4 py-2.5 text-right">Available</th>
              <th className="px-4 py-2.5 text-right">Min</th>
              <th className="px-4 py-2.5 text-right">Reorder to</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {reorderPoints.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No reorder points set. Add one above.
                </td>
              </tr>
            ) : (
              reorderPoints.map((rp) => {
                const low = rp.available <= rp.minQty;
                return (
                  <tr key={rp.id} className="border-t border-white/5">
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">{rp.sku ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-white">{rp.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{rp.onHand}</td>
                    <td className={`px-4 py-2.5 text-right text-xs ${low ? "text-amber-300 font-semibold" : ""}`}>{rp.available}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{rp.minQty}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{rp.reorderToQty}</td>
                    <td className="px-4 py-2.5 text-right text-xs">
                      {low ? <span className="text-amber-300 text-[10px] uppercase tracking-wider">at/below min</span> : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        A reorder point raises an open requisition automatically when a part&apos;s available (on-hand − reserved) drops
        to its min. Pulling reserved stock is only possible through the override above, which logs who &amp; why and
        raises a requisition due by the raided build&apos;s date. &ldquo;Create PO&rdquo; turns a requisition into an
        individual PO whose received stock lands as a <span className="font-mono">backfill</span> cost layer.
      </p>
    </AppShell>
  );
}
