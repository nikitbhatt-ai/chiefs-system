import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq, and, count, arrayContains } from "drizzle-orm";
import { db } from "@/db";
import { packages } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import { ListRowControls } from "@/components/ListRowControls";
import { parsePagination } from "@/lib/pagination";
import { packageValue, packageCounts } from "@/lib/packages";

async function createPackage(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const [row] = await db
    .insert(packages)
    .values({
      name,
      category: String(formData.get("category") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      components: [],
    })
    .returning({ id: packages.id });
  revalidatePath("/packages");
  // Send the user straight into the builder to add parts / labor / fees.
  redirect(`/packages/${row.id}/edit`);
}

async function deletePackage(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(packages).where(eq(packages.id, id));
  revalidatePath("/packages");
}

async function archivePackage(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  if (!id) return;
  await db
    .update(packages)
    .set({ archived: archive, updatedAt: new Date() })
    .where(eq(packages.id, id));
  revalidatePath("/packages");
}

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; page?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const tag = (sp.tag ?? "").trim();
  const { page, perPage, offset } = parsePagination(sp.page);

  const filters = [];
  if (tag) filters.push(arrayContains(packages.tags, [tag]));
  if (sp.archived === "1") filters.push(eq(packages.archived, true));
  else filters.push(eq(packages.archived, false));
  const where = filters.length ? and(...filters) : undefined;

  const [totalRows, rows] = await Promise.all([
    db.select({ n: count() }).from(packages).where(where),
    db.select().from(packages).where(where).orderBy(desc(packages.createdAt)).limit(perPage).offset(offset),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);

  const pagerBaseQuery = (() => {
    const qs = new URLSearchParams();
    if (sp.archived === "1") qs.set("archived", "1");
    if (tag) qs.set("tag", tag);
    return qs.toString();
  })();

  return (
    <AppShell title="Packages" subtitle="Reusable part + labor bundles the sales team can quote in one click">
      <div className="bg-surface border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          New package
        </h3>
        <form action={createPackage} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            name="name"
            required
            placeholder="Package name * (e.g. Standard Patrol Upfit)"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
          />
          <input
            name="category"
            placeholder="Category (e.g. Patrol, Fire, Admin)"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <textarea
            name="description"
            placeholder="Description (optional)"
            rows={2}
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-3"
          />
          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
            >
              Create & build →
            </button>
          </div>
        </form>
        <p className="text-[11px] text-zinc-500 mt-2">
          Load inventory first (<a href="/inventory/import" className="text-amber-400 hover:text-amber-300">Import inventory CSV</a>)
          so package parts link to real SKUs, then build packages here or{" "}
          <a href="/packages/import" className="text-amber-400 hover:text-amber-300">bulk-import packages by CSV</a>.
        </p>
      </div>

      <form className="bg-surface border border-white/5 rounded-lg p-3 flex flex-wrap gap-2 items-center text-xs font-body">
        <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Filter:</span>
        <label className="flex items-center gap-1 text-zinc-400">
          <input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} />
          Show archived
        </label>
        <button type="submit" className="ml-auto text-amber-400 hover:text-amber-300 px-3 py-1 border border-white/10 rounded">
          Apply
        </button>
        <a href="/packages" className="text-zinc-500 hover:text-white">
          Reset
        </a>
        <a href="/packages/import" className="text-zinc-300 hover:text-white px-3 py-1 border border-white/10 rounded">
          Import CSV
        </a>
      </form>

      {tag ? (
        <div className="text-[11px] font-body text-zinc-400">
          Filtering by tag <span className="text-amber-400">#{tag}</span> ·{" "}
          <a href="/packages" className="text-zinc-500 hover:text-white underline">clear</a>
        </div>
      ) : null}

      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5">Contents</th>
              <th className="px-3 py-2.5 text-right">Package value</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No packages {sp.archived === "1" ? "archived" : "yet"}. Create one above.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const c = packageCounts(p.components ?? []);
                return (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-2 text-xs text-white">
                      <a href={`/packages/${p.id}/edit`} className="hover:text-amber-300">
                        {p.name}
                      </a>
                      {p.description ? (
                        <div className="text-[10px] text-zinc-500">{p.description}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{p.category ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400">
                      {c.parts} part{c.parts === 1 ? "" : "s"}
                      {c.labor ? ` · ${c.labor} labor` : ""}
                      {c.fees ? ` · ${c.fees} fee${c.fees === 1 ? "" : "s"}` : ""}
                    </td>
                    <td className="px-3 py-2 text-xs text-right text-white">
                      {fmtMoney(packageValue(p.components ?? []))}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2 mb-1">
                        <ListRowControls entity="packages" id={p.id} tags={p.tags ?? []} archived={p.archived} showArchive={false} />
                      </div>
                      <a href={`/packages/${p.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300 mr-3">
                        Edit
                      </a>
                      <form action={archivePackage} className="inline mr-3">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="archive" value={p.archived ? "0" : "1"} />
                        <button type="submit" className="text-[11px] text-zinc-500 hover:text-white">
                          {p.archived ? "Unarchive" : "Archive"}
                        </button>
                      </form>
                      <form action={deletePackage} className="inline">
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="text-[11px] text-zinc-500 hover:text-red-400">
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
        <Pagination page={page} total={total} perPage={perPage} baseQuery={pagerBaseQuery} />
      </div>
    </AppShell>
  );
}
