import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { vendorPartPrice, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { FormField } from "@/components/FormField";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import { setCurrentPrice } from "@/lib/vendorPricing";

// The à la carte price list: what each part costs bought individually from a
// vendor. This is the allocation basis for promo packages (Phase 3) and the
// pre-fill for individual PO lines (Phase 4) — kept separate from parts.cost,
// which tracks the moving average and drifts below à la carte once discounted
// package stock is received.

async function savePrice(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const vendorId = String(formData.get("vendorId") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const cost = String(formData.get("cost") ?? "").trim();
  const sourceNote = String(formData.get("sourceNote") ?? "").trim() || null;
  if (!vendorId || !sku || !cost) return;
  await setCurrentPrice({ vendorId, sku, cost, sourceNote });
  revalidatePath("/vendor-pricing");
}

async function deletePrice(formData: FormData) {
  "use server";
  const session = await auth();
  if (!canDelete(session)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(vendorPartPrice).where(eq(vendorPartPrice.id, id));
  revalidatePath("/vendor-pricing");
}

function fmtMoney(v: string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function VendorPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const showHistory = sp.view === "history";

  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(vendors.name);
  const vendorName = new Map(vendorRows.map((v) => [v.id, v.name]));

  // Current view shows only open rows; history view shows every row so closed
  // prices stay explainable against the POs placed while they were live.
  const rows = await db
    .select()
    .from(vendorPartPrice)
    .where(showHistory ? undefined : isNull(vendorPartPrice.effectiveTo))
    .orderBy(vendorPartPrice.sku, desc(vendorPartPrice.effectiveFrom), desc(vendorPartPrice.createdAt));

  return (
    <AppShell title="Vendor Pricing" subtitle="À la carte cost basis">
      <div className="bg-surface border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-1">
          Set à la carte price
        </h3>
        <p className="text-[11px] text-zinc-500 font-body mb-3">
          Changing a price never overwrites the old one — it closes the current
          row and starts a new one, so historical POs stay explainable.
        </p>
        <form action={savePrice} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label="Vendor" required>
            <select
              name="vendorId"
              required
              defaultValue=""
              className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="" disabled>
                — Select vendor —
              </option>
              {vendorRows.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="SKU" required hint="Manufacturer part number as it appears in inventory">
            <input
              name="sku"
              required
              placeholder="e.g. XI3JC"
              className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
          </FormField>
          <FormField label="À la carte unit cost" required hint="What we pay per part outside a package">
            <input
              name="cost"
              required
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
          </FormField>
          <FormField label="Source note" hint="e.g. Whelen dealer net, 2026 price file">
            <input
              name="sourceNote"
              placeholder="Where this price came from"
              className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
          </FormField>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
            >
              Save price
            </button>
          </div>
        </form>
      </div>

      <div className="flex items-center gap-3 text-xs font-body">
        <a
          href="/vendor-pricing"
          className={`px-3 py-1.5 rounded-md ${!showHistory ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
        >
          Current prices
        </a>
        <a
          href="/vendor-pricing?view=history"
          className={`px-3 py-1.5 rounded-md ${showHistory ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
        >
          Full history
        </a>
      </div>

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5 text-right">À la carte cost</th>
              <th className="px-4 py-2.5">Effective from</th>
              {showHistory && <th className="px-4 py-2.5">Effective to</th>}
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showHistory ? 7 : 6} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No prices yet — add the first à la carte cost above.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const closed = r.effectiveTo != null;
                return (
                  <tr key={r.id} className={`border-t border-white/5 ${closed ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 text-xs">{vendorName.get(r.vendorId) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-white font-mono text-xs">{r.sku}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(r.alacarteUnitCost)}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{r.effectiveFrom}</td>
                    {showHistory && (
                      <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                        {r.effectiveTo ?? <span className="text-green-400">current</span>}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-xs text-zinc-400">{r.sourceNote ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <form action={deletePrice} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          className="text-[11px] text-zinc-500 hover:text-red-400 font-body"
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
