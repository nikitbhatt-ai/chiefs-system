import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, arrayContains, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { quotes, customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import { ListRowControls } from "@/components/ListRowControls";
import { ListFilters } from "@/components/ListFilters";
import { parsePagination } from "@/lib/pagination";
import { canDelete } from "@/lib/rbac";
import { auth } from "@/auth";
import { unlinkQuote, upsertQuoteLink } from "@/lib/customerDocLinks";
import { fmtDateTime } from "@/lib/datetime";

const QUOTE_STATUSES = ["draft", "sent", "approved", "converted"];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  approved: "bg-green-500/10 text-green-300 border-green-500/30",
  converted: "bg-purple-500/10 text-purple-300 border-purple-500/30",
};

async function createQuote(formData: FormData) {
  "use server";
  const customerId = String(formData.get("customerId") ?? "") || null;
  const quoteNumber = `Q-${Date.now().toString().slice(-7)}`;
  const [row] = await db
    .insert(quotes)
    .values({
      quoteNumber,
      customerId,
      status: "draft",
      lineItems: [],
      subtotal: "0",
      taxTotal: "0",
      grandTotal: "0",
    })
    .returning();
  if (customerId) {
    await upsertQuoteLink(row.id);
    revalidatePath(`/crm/${customerId}`);
  }
  revalidatePath("/quotes");
  redirect(`/quotes/${row.id}`);
}

async function deleteQuote(formData: FormData) {
  "use server";
  const session = await auth();
  if (!canDelete(session)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [q] = await db.select({ customerId: quotes.customerId }).from(quotes).where(eq(quotes.id, id));
  await unlinkQuote(id);
  await db.delete(quotes).where(eq(quotes.id, id));
  revalidatePath("/quotes");
  revalidatePath("/workflow");
  if (q?.customerId) revalidatePath(`/crm/${q.customerId}`);
}

function fmtMoney(v: string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; view?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = (sp.status ?? "").trim();
  const view = sp.view === "archived" ? "archived" : "active";
  const tag = (sp.tag ?? "").trim();
  const { page, perPage, offset } = parsePagination(sp.page);

  const customerRows = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .orderBy(customers.name);

  const filters = [eq(quotes.archived, view === "archived")];
  if (tag) filters.push(arrayContains(quotes.tags, [tag]));
  if (status) filters.push(eq(quotes.status, status as typeof quotes.$inferSelect.status));
  if (q) {
    const like = `%${q}%`;
    const matchCustomerIds = (
      await db.select({ id: customers.id }).from(customers).where(ilike(customers.name, like))
    ).map((c) => c.id);
    const ors = [ilike(quotes.quoteNumber, like)];
    if (matchCustomerIds.length) ors.push(inArray(quotes.customerId, matchCustomerIds));
    const orCond = or(...ors);
    if (orCond) filters.push(orCond);
  }
  const where = and(...filters);
  const baseQuery = (() => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (status) qs.set("status", status);
    if (view === "archived") qs.set("view", "archived");
    if (tag) qs.set("tag", tag);
    return qs.toString();
  })();

  const [totalRows, rows] = await Promise.all([
    db.select({ n: count() }).from(quotes).where(where),
    db.select().from(quotes).where(where).orderBy(desc(quotes.createdAt)).limit(perPage).offset(offset),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);
  const customerIds = Array.from(new Set(rows.map((r) => r.customerId).filter(Boolean) as string[]));
  const customerMap = new Map(
    customerIds.length
      ? (
          await db
            .select({ id: customers.id, name: customers.name })
            .from(customers)
            .where(inArray(customers.id, customerIds))
        ).map((r) => [r.id, r.name])
      : [],
  );

  return (
    <AppShell title="Quotes" subtitle="Estimates and quotes for customers">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          New quote
        </h3>
        <form action={createQuote} className="flex gap-3 items-end">
          <select
            name="customerId"
            defaultValue=""
            className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="">— Customer (optional) —</option>
            {customerRows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
          >
            Create draft
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <form method="get" className="flex flex-wrap items-center gap-2">
          {view === "archived" && <input type="hidden" name="view" value="archived" />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          <input name="q" defaultValue={q} placeholder="Search quote # or customer…" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 flex-1 min-w-[220px]" />
          <select name="status" defaultValue={status} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">All statuses</option>
            {QUOTE_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <button type="submit" className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-4 py-2">Filter</button>
          {(q || status) && (<a href="/quotes" className="text-[11px] text-zinc-400 hover:text-zinc-200">Clear</a>)}
        </form>
        <ListFilters basePath="/quotes" view={view} tag={tag} carry={{ q, status }} />
      </div>
      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Quote #</th>
              <th className="px-4 py-2.5">Customer</th>
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
                  No quotes yet — create your first draft above.
                </td>
              </tr>
            ) : (
              rows.map((q) => (
                <tr key={q.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white font-mono text-xs">
                    {q.quoteNumber ?? q.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {q.customerId ? customerMap.get(q.customerId) ?? "—" : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[q.status]}`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right">
                    {fmtMoney(q.grandTotal)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                    {fmtDateTime(q.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2 mb-1"><ListRowControls entity="quotes" id={q.id} tags={q.tags ?? []} archived={q.archived} /></div>
                    <a
                      href={`/quotes/${q.id}`}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3"
                    >
                      Open
                    </a>
                    <form action={deleteQuote} className="inline">
                      <input type="hidden" name="id" value={q.id} />
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
        <Pagination page={page} total={total} perPage={perPage} baseQuery={baseQuery} />
      </div>
    </AppShell>
  );
}
