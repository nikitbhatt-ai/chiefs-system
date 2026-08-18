import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, arrayContains, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import { ListRowControls } from "@/components/ListRowControls";
import { ListFilters } from "@/components/ListFilters";
import { parsePagination } from "@/lib/pagination";
import { canDelete } from "@/lib/rbac";
import { auth } from "@/auth";
import { fmtDateTime } from "@/lib/datetime";
import { poStatusLabel, poStatusColor, PO_MANUAL_STATUSES } from "@/lib/poStatus";
import { SubmitButton } from "@/components/SubmitButton";

// Statuses offered in the list filter, in workflow order.
const PO_STATUSES = ["pending", "ordered", "partially_received", "fulfilled"];

async function createPO(formData: FormData) {
  "use server";
  const vendorId = String(formData.get("vendorId") ?? "") || null;
  const statusRaw = String(formData.get("status") ?? "pending");
  const status = statusRaw === "ordered" ? "ordered" : "pending";
  const poNumber = `PO-${Date.now().toString().slice(-7)}`;
  const [row] = await db
    .insert(purchaseOrders)
    .values({ poNumber, vendorId, status, lineItems: [] })
    .returning();
  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${row.id}`);
}

async function deletePO(formData: FormData) {
  "use server";
  const session = await auth();
  if (!canDelete(session)) return;
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

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; view?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const status = (sp.status ?? "").trim();
  const view = sp.view === "archived" ? "archived" : "active";
  const tag = (sp.tag ?? "").trim();
  const { page, perPage, offset } = parsePagination(sp.page);

  const filters = [eq(purchaseOrders.archived, view === "archived")];
  if (tag) filters.push(arrayContains(purchaseOrders.tags, [tag]));
  if (status) filters.push(eq(purchaseOrders.status, status as typeof purchaseOrders.$inferSelect.status));
  const where = and(...filters);
  const baseQuery = (() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (view === "archived") qs.set("view", "archived");
    if (tag) qs.set("tag", tag);
    return qs.toString();
  })();

  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(vendors.name);

  const [totalRows, rows] = await Promise.all([
    db.select({ n: count() }).from(purchaseOrders).where(where),
    db.select().from(purchaseOrders).where(where).orderBy(desc(purchaseOrders.createdAt)).limit(perPage).offset(offset),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);

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
      <div className="bg-surface border border-white/5 rounded-lg p-4">
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
          <select
            name="status"
            defaultValue="pending"
            title="Received and Fulfilled are set automatically as parts are received"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            {PO_MANUAL_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <SubmitButton
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2"
          >
            Create draft
          </SubmitButton>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <form method="get" className="flex flex-wrap items-center gap-2">
          {view === "archived" && <input type="hidden" name="view" value="archived" />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          <select name="status" defaultValue={status} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">All statuses</option>
            {PO_STATUSES.map((s) => (<option key={s} value={s}>{poStatusLabel(s)}</option>))}
          </select>
          <button type="submit" className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-4 py-2">Filter</button>
          {status && (<a href="/purchase-orders" className="text-[11px] text-zinc-400 hover:text-zinc-200">Clear</a>)}
        </form>
        <ListFilters basePath="/purchase-orders" view={view} tag={tag} carry={{ status }} />
      </div>
      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
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
                      className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${poStatusColor(p.status)}`}
                    >
                      {poStatusLabel(p.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right">{fmt(p.total)}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2 mb-1"><ListRowControls entity="purchase-orders" id={p.id} tags={p.tags ?? []} archived={p.archived} /></div>
                    <a
                      href={`/purchase-orders/${p.id}`}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3"
                    >
                      Open
                    </a>
                    <form action={deletePO} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton
                        className="text-[11px] text-zinc-500 hover:text-red-400 font-body"
                      >
                        Delete
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={page} total={total} perPage={perPage} baseQuery={baseQuery} />
      </div>
    </AppShell>
  );
}
