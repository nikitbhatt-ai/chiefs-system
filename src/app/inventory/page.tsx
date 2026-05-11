import { revalidatePath } from "next/cache";
import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { parts, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { PartAddForm } from "./PartAddForm";

async function createPart(formData: FormData) {
  "use server";
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!sku || !name) return;
  const num = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : Number(v);
  };
  await db.insert(parts).values({
    sku,
    name,
    description: String(formData.get("description") ?? "").trim() || null,
    category: String(formData.get("category") ?? "").trim() || null,
    quantityOnHand: num("quantityOnHand") ?? 0,
    quantityOnOrder: num("quantityOnOrder") ?? 0,
    reorderPoint: num("reorderPoint"),
    cost: num("cost") != null ? String(num("cost")) : null,
    price: num("price") != null ? String(num("price")) : null,
    vendorId: String(formData.get("vendorId") ?? "") || null,
    manufacturerId: String(formData.get("manufacturerId") ?? "") || null,
  });
  revalidatePath("/inventory");
}

async function deletePart(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(parts).where(eq(parts.id, id));
  revalidatePath("/inventory");
}

async function archivePart(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  if (!id) return;
  await db
    .update(parts)
    .set({ archived: archive, updatedAt: new Date() })
    .where(eq(parts.id, id));
  revalidatePath("/inventory");
}

function fmtMoney(v: string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function pct(cost: string | null, price: string | null) {
  const c = cost ? Number(cost) : null;
  const p = price ? Number(price) : null;
  if (c == null || p == null || c <= 0 || p <= 0) return { margin: null, markup: null };
  const margin = ((p - c) / p) * 100;
  const markup = ((p - c) / c) * 100;
  return { margin, markup };
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; vendor?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const filters = [];
  if (sp.category) filters.push(eq(parts.category, sp.category));
  if (sp.vendor) filters.push(eq(parts.vendorId, sp.vendor));
  if (sp.archived === "1") filters.push(eq(parts.archived, true));
  else filters.push(eq(parts.archived, false));

  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(vendors.name);
  const vendorMap = new Map(vendorRows.map((v) => [v.id, v.name]));

  const rows = await db
    .select()
    .from(parts)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(parts.createdAt));

  const categoriesRaw = await db
    .selectDistinct({ category: parts.category })
    .from(parts)
    .where(sql`${parts.category} is not null`);
  const categories = categoriesRaw.map((r) => r.category!).filter(Boolean);

  const printQs = (() => {
    const qs = new URLSearchParams();
    if (sp.category) qs.set("category", sp.category);
    if (sp.vendor) qs.set("vendor", sp.vendor);
    if (sp.archived === "1") qs.set("archived", "1");
    const s = qs.toString();
    return s ? `?${s}` : "";
  })();

  return (
    <AppShell title="Inventory" subtitle="Parts and supplies">
      <PartAddForm action={createPart} vendors={vendorRows} />

      <form className="bg-[#161624] border border-white/5 rounded-lg p-3 flex flex-wrap gap-2 items-center text-xs font-body">
        <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Filter:</span>
        <select
          name="category"
          defaultValue={sp.category ?? ""}
          className="bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="vendor"
          defaultValue={sp.vendor ?? ""}
          className="bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
        >
          <option value="">All vendors</option>
          {vendorRows.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-zinc-400">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={sp.archived === "1"}
          />
          Show archived
        </label>
        <button
          type="submit"
          className="ml-auto text-amber-400 hover:text-amber-300 px-3 py-1 border border-white/10 rounded"
        >
          Apply
        </button>
        <a href="/inventory" className="text-zinc-500 hover:text-white">
          Reset
        </a>
        <a
          href={`/inventory/print${printQs}`}
          target="_blank"
          className="text-zinc-300 hover:text-white px-3 py-1 border border-white/10 rounded"
        >
          Print / Save as PDF
        </a>
        <a
          href="/inventory/import"
          className="text-zinc-300 hover:text-white px-3 py-1 border border-white/10 rounded"
        >
          Import CSV
        </a>
      </form>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">SKU</th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5">Manufacturer</th>
              <th className="px-3 py-2.5">Supplier</th>
              <th className="px-3 py-2.5 text-right">On hand</th>
              <th className="px-3 py-2.5 text-right">On order</th>
              <th className="px-3 py-2.5 text-right">Internal cost</th>
              <th className="px-3 py-2.5 text-right">Price</th>
              <th className="px-3 py-2.5 text-right">Margin</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No parts {sp.archived === "1" ? "archived" : "in inventory"} yet.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const { margin } = pct(p.cost, p.price);
                return (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-white">{p.sku}</td>
                    <td className="px-3 py-2 text-xs text-white">
                      {p.name}
                      {p.restricted ? (
                        <span className="ml-2 inline-block text-[9px] uppercase tracking-wider rounded border border-red-500/40 bg-red-500/10 text-red-300 px-1.5 py-0.5">
                          Restricted{p.restrictionCategory ? ` · ${p.restrictionCategory.replace(/_/g, " ")}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{p.category ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {p.manufacturerId ? vendorMap.get(p.manufacturerId) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.vendorId ? vendorMap.get(p.vendorId) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-right">{p.quantityOnHand}</td>
                    <td className="px-3 py-2 text-xs text-right">{p.quantityOnOrder}</td>
                    <td className="px-3 py-2 text-xs text-right">{fmtMoney(p.cost)}</td>
                    <td className="px-3 py-2 text-xs text-right">{fmtMoney(p.price)}</td>
                    <td className="px-3 py-2 text-xs text-right">
                      {margin != null ? `${margin.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <a
                        href={`/inventory/${p.id}`}
                        className="text-[11px] text-blue-400 hover:text-blue-300 mr-3"
                      >
                        Cost history
                      </a>
                      <a
                        href={`/inventory/${p.id}/edit`}
                        className="text-[11px] text-amber-400 hover:text-amber-300 mr-3"
                      >
                        Edit
                      </a>
                      <form action={archivePart} className="inline mr-3">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="archive" value={p.archived ? "0" : "1"} />
                        <button
                          type="submit"
                          className="text-[11px] text-zinc-500 hover:text-white"
                        >
                          {p.archived ? "Unarchive" : "Archive"}
                        </button>
                      </form>
                      <form action={deletePart} className="inline">
                        <input type="hidden" name="id" value={p.id} />
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
