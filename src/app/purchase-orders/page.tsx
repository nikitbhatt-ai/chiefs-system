import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  pending_review: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  po_received: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  partially_received: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  received: "bg-green-500/10 text-green-300 border-green-500/30",
};

async function createPO(formData: FormData) {
  "use server";
  const vendorId = String(formData.get("vendorId") ?? "") || null;
  const poNumber = `PO-${Date.now().toString().slice(-7)}`;
  const [row] = await db
    .insert(purchaseOrders)
    .values({ poNumber, vendorId, status: "pending", lineItems: [] })
    .returning();
  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${row.id}`);
}

async function deletePO(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  revalidatePath("/purchase-orders");
}

function fmt(v: string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function PurchaseOrdersPage() {
  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(vendors.name);

  const rows = await db
    .select()
    .from(purchaseOrders)
    .orderBy(desc(purchaseOrders.createdAt));

  const vendorIds = Array.from(
    new Set(rows.map((r) => r.vendorId).filter(Boolean) as string[]),
  );
  const vMap = new Map(
    vendorIds.length
      ? (
          await db
            .select({ id: vendors.id, name: vendors.name })
            .from(vendors)
            .where(inArray(vendors.id, vendorIds))
        ).map((v) => [v.id, v.name])
      : [],
  );

  return (
    <AppShell title="Purchase Orders" subtitle="Buying & receiving">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          New PO
        </h3>
        <form action={createPO} className="flex gap-3 items-end">
          <select
            name="vendorId"
            defaultValue=""
            className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="">— Vendor (optional) —</option>
            {vendorRows.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2"
          >
            Create draft
          </button>
        </form>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">PO #</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No purchase orders yet.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs text-white">
                    {p.poNumber ?? p.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {p.vendorId ? vMap.get(p.vendorId) ?? "—" : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[p.status]}`}
                    >
                      {p.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right">{fmt(p.total)}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <a
                      href={`/purchase-orders/${p.id}`}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3"
                    >
                      Open
                    </a>
                    <form action={deletePO} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        className="text-[11px] text-zinc-500 hover:text-red-400 font-body"
                      >
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
