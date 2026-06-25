import { revalidatePath } from "next/cache";
import { and, arrayContains, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import { ListRowControls } from "@/components/ListRowControls";
import { ListFilters } from "@/components/ListFilters";
import { parsePagination } from "@/lib/pagination";
import { canDelete } from "@/lib/rbac";
import { auth } from "@/auth";
import { fmtDateTime } from "@/lib/datetime";

async function createCustomer(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const type = String(formData.get("type") ?? "commercial") as
    | "government"
    | "commercial"
    | "retail";
  await db.insert(customers).values({
    name,
    type,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    taxExempt: formData.get("taxExempt") === "on",
  });
  revalidatePath("/crm");
}

async function deleteCustomer(formData: FormData) {
  "use server";
  const session = await auth();
  if (!canDelete(session)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(customers).where(eq(customers.id, id));
  revalidatePath("/crm");
}

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; view?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const view = sp.view === "archived" ? "archived" : "active";
  const tag = (sp.tag ?? "").trim();
  const { page, perPage, offset } = parsePagination(sp.page);

  const filters = [eq(customers.archived, view === "archived")];
  if (tag) filters.push(arrayContains(customers.tags, [tag]));
  if (q) {
    const like = `%${q}%`;
    const orCond = or(ilike(customers.name, like), ilike(customers.email, like), ilike(customers.phone, like));
    if (orCond) filters.push(orCond);
  }
  const where = and(...filters);
  const baseQuery = (() => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (view === "archived") qs.set("view", "archived");
    if (tag) qs.set("tag", tag);
    return qs.toString();
  })();

  const [totalRows, rows] = await Promise.all([
    db.select({ n: count() }).from(customers).where(where),
    db.select().from(customers).where(where).orderBy(desc(customers.createdAt)).limit(perPage).offset(offset),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);

  return (
    <AppShell title="Customers" subtitle="CRM directory">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">Add customer</h3>
        <form action={createCustomer} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input name="name" required placeholder="Name *" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <select name="type" defaultValue="commercial" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="commercial">Commercial</option>
            <option value="government">Government</option>
            <option value="retail">Retail</option>
          </select>
          <input name="email" type="email" placeholder="Email" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="phone" placeholder="Phone" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="address" placeholder="Address" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2" />
          <label className="flex items-center gap-2 text-xs text-zinc-300 font-body">
            <input type="checkbox" name="taxExempt" />
            Tax exempt
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">Save customer</button>
          </div>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <form method="get" className="flex flex-wrap items-center gap-2">
          {view === "archived" && <input type="hidden" name="view" value="archived" />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          <input name="q" defaultValue={q} placeholder="Search name, email, phone…" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 flex-1 min-w-[220px]" />
          <button type="submit" className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-4 py-2">Search</button>
          {q && (<a href="/crm" className="text-[11px] text-zinc-400 hover:text-zinc-200">Clear</a>)}
        </form>
        <ListFilters basePath="/crm" view={view} tag={tag} carry={{ q }} />
      </div>
      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Tax</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">No customers yet — add your first one above.</td></tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">{c.name}</td>
                  <td className="px-4 py-2.5 capitalize text-xs">{c.type}</td>
                  <td className="px-4 py-2.5 text-xs">{c.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{c.taxExempt ? "Exempt" : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(c.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2 mb-1"><ListRowControls entity="customers" id={c.id} tags={c.tags ?? []} archived={c.archived} /></div>
                    <a href={`/crm/${c.id}`} className="text-[11px] text-blue-400 hover:text-blue-300 font-body mr-3">Open</a>
                    <a href={`/crm/${c.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3">Edit</a>
                    <form action={deleteCustomer} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className="text-[11px] text-zinc-500 hover:text-red-400 font-body">Delete</button>
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
