import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { auth } from "@/auth";
import { canDelete } from "@/lib/rbac";
import {
  listPromos,
  getPromoWithLines,
  allocationInputFor,
  setPromoStatus,
  deletePromo,
  syncPromoToPackage,
} from "@/lib/promos";
import { allocatePromo } from "@/lib/promoAllocation";
import { PromoBuilder } from "./PromoBuilder";

export const dynamic = "force-dynamic";

const money = (v: string | number | null | undefined) => {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
};

export default async function VendorPromosPage() {
  const [vendorRows, promos] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).orderBy(asc(vendors.name)),
    listPromos(),
  ]);

  // Attach the à la carte basis + saving per promo (small N — admin screen).
  const withAlloc = await Promise.all(
    promos.map(async (p) => {
      const pwl = await getPromoWithLines(p.id);
      let basis: number | null = null;
      let saving: number | null = null;
      let err: string | null = null;
      if (pwl) {
        try {
          const a = allocatePromo(allocationInputFor(pwl));
          basis = a.totalBasis;
          saving = a.saving;
        } catch (e) {
          err = (e as Error).message;
        }
      }
      return { ...p, basis, saving, err };
    }),
  );

  async function retire(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    await setPromoStatus(String(formData.get("id")), "retired");
    revalidatePath("/vendor-promos");
  }
  async function activate(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    await setPromoStatus(String(formData.get("id")), "active");
    revalidatePath("/vendor-promos");
  }
  async function addToPackages(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const res = await syncPromoToPackage(String(formData.get("id")));
    if (!res.ok) return;
    revalidatePath("/packages");
    // Drop into the builder so the team can adjust the markup / sell prices.
    redirect(`/packages/${res.packageId}/edit`);
  }
  async function remove(formData: FormData) {
    "use server";
    const session = await auth();
    if (!canDelete(session)) return;
    await deletePromo(String(formData.get("id")));
    revalidatePath("/vendor-promos");
  }

  return (
    <AppShell title="Vendor promos" subtitle="Package deals — one price for a fixed basket, allocated across the parts">
      <div className="flex items-center gap-3">
        <Link href="/packages/import-template" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5">
          ⬆ Import promo from a vendor sheet
        </Link>
        <Link href="/vendor-pricing" className="text-xs text-amber-400 hover:text-amber-300 font-body">à la carte price list →</Link>
        <Link href="/purchase-orders" className="text-xs text-amber-400 hover:text-amber-300 font-body">Purchase orders →</Link>
      </div>
      <p className="text-[11px] text-zinc-500 font-body -mt-1">
        Uploading a vendor sheet loads the à la carte prices, creates the allocated promo, and builds a sellable
        package in one step — no need to type SKUs below. Use the builder below only for a quick one-off promo.
      </p>

      {vendorRows.length === 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 font-body">
          Add a vendor first — promos are defined against a vendor&apos;s price list.
        </div>
      ) : (
        <PromoBuilder vendors={vendorRows} />
      )}

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 font-body">
          Defined promos ({withAlloc.length})
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Promo</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5 text-right">Lines</th>
              <th className="px-4 py-2.5 text-right">À la carte</th>
              <th className="px-4 py-2.5 text-right">Package</th>
              <th className="px-4 py-2.5 text-right">Saving</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {withAlloc.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No promos yet. Define one above.
                </td>
              </tr>
            ) : (
              withAlloc.map((p) => (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 text-xs text-white">{p.name}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400">{p.vendorName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right text-xs">{p.lineCount}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-zinc-400">{money(p.basis)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">{money(p.packagePrice)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-emerald-300">
                    {p.err ? <span className="text-red-400" title={p.err}>invalid</span> : money(p.saving)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                        p.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <form action={addToPackages} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        title="Create/refresh a sellable package from this promo (cost from the promo, sell at the package markup) and open it in the builder"
                        className="text-[11px] text-emerald-300 hover:text-emerald-200 px-1.5"
                      >
                        Add to Packages
                      </button>
                    </form>
                    {p.status === "active" ? (
                      <form action={retire} className="inline">
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-[11px] text-zinc-400 hover:text-white px-1.5">Retire</button>
                      </form>
                    ) : (
                      <form action={activate} className="inline">
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-[11px] text-amber-400 hover:text-amber-300 px-1.5">Activate</button>
                      </form>
                    )}
                    <form action={remove} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-[11px] text-zinc-500 hover:text-red-400 px-1.5">Delete</button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 font-body">
        Each line snapshots its à la carte cost from the price list when the promo is saved, so a later price change never
        rewrites a defined promo. The package price is spread across the lines in proportion to that basis; a rounding
        plug ties the allocation to the package price exactly. A package that costs more than its à la carte basket is
        refused. Applying a promo to a purchase order (Phase 4) stamps these allocated costs onto the PO line.
      </p>
    </AppShell>
  );
}
