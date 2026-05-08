import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@/db";
import { customers, deals, quotes, workOrders, notes, users } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  quote_sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  po_received: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_production: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  delivered: "bg-green-500/10 text-green-300 border-green-500/30",
  lost: "bg-red-500/10 text-red-300 border-red-500/30",
};

function fmt(v: string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function CustomerEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) notFound();

  const [dealRows, quoteRows, woRows, noteRows] = await Promise.all([
    db.select().from(deals).where(eq(deals.customerId, id)).orderBy(desc(deals.createdAt)),
    db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)),
    db.select().from(workOrders).where(eq(workOrders.customerId, id)).orderBy(desc(workOrders.createdAt)),
    db.select({ id: notes.id, body: notes.body, authorId: notes.authorId, createdAt: notes.createdAt }).from(notes).where(and(eq(notes.entityType, "customer"), eq(notes.entityId, id))).orderBy(desc(notes.createdAt)),
  ]);

  const authorIds = Array.from(new Set(noteRows.map((n) => n.authorId).filter(Boolean) as string[]));
  const authorRows = authorIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.active, true))
    : [];
  const authorMap = new Map(authorRows.map((a) => [a.id, a.name ?? a.email]));

  async function addNote(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    await db.insert(notes).values({ entityType: "customer", entityId: id, body, authorId: session.user.id });
    revalidatePath(`/crm/${id}`);
  }

  async function deleteNote(formData: FormData) {
    "use server";
    const noteId = String(formData.get("noteId") ?? "");
    if (!noteId) return;
    await db.delete(notes).where(eq(notes.id, noteId));
    revalidatePath(`/crm/${id}`);
  }

  return (
    <AppShell title={c.name} subtitle={`${c.type} customer`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 md:col-span-2 space-y-2 text-xs font-body text-zinc-300">
          <div><span className="text-zinc-500 uppercase tracking-wider text-[10px] mr-2">Email:</span>{c.email ?? "—"}</div>
          <div><span className="text-zinc-500 uppercase tracking-wider text-[10px] mr-2">Phone:</span>{c.phone ?? "—"}</div>
          <div><span className="text-zinc-500 uppercase tracking-wider text-[10px] mr-2">Address:</span>{c.address ?? "—"}</div>
          <div><span className="text-zinc-500 uppercase tracking-wider text-[10px] mr-2">Tax exempt:</span>{c.taxExempt ? "Yes" : "No"}</div>
          <div className="pt-2">
            <a href={`/crm/${c.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300">Edit customer</a>
            <span className="text-zinc-600 mx-2">·</span>
            <a href="/crm" className="text-[11px] text-zinc-400 hover:text-white">Back to list</a>
          </div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Deals" value={dealRows.length} />
          <Stat label="Quotes" value={quoteRows.length} />
          <Stat label="Work orders" value={woRows.length} />
        </div>
      </div>

      <Section title="Internal notes">
        <form action={addNote} className="flex gap-2 mb-3">
          <textarea name="body" rows={2} placeholder="Add an internal note (visible to staff only)…" className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs font-body text-white placeholder:text-zinc-500" />
          <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 self-start">Post</button>
        </form>
        {noteRows.length === 0 ? (<p className="text-xs text-zinc-500 font-body">No notes yet.</p>) : (
          <ul className="space-y-2">
            {noteRows.map((n) => (
              <li key={n.id} className="bg-black/30 border border-white/5 rounded-md p-2.5 text-xs font-body">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-zinc-400">{(n.authorId && authorMap.get(n.authorId)) ?? "—"} · {new Date(n.createdAt).toLocaleString()}</span>
                  <form action={deleteNote} className="inline">
                    <input type="hidden" name="noteId" value={n.id} />
                    <button type="submit" className="text-[10px] text-zinc-500 hover:text-red-400">Delete</button>
                  </form>
                </div>
                <div className="whitespace-pre-wrap text-white">{n.body}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Deals">
        {dealRows.length === 0 ? (<p className="text-xs text-zinc-500 font-body">No deals.</p>) : (
          <table className="w-full text-xs font-body">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500"><th className="px-2 py-1">Vehicle</th><th className="px-2 py-1">Stage</th><th className="px-2 py-1">Referral</th><th className="px-2 py-1">Created</th><th className="px-2 py-1"></th></tr></thead>
            <tbody className="text-zinc-200">
              {dealRows.map((d) => (
                <tr key={d.id} className="border-t border-white/5">
                  <td className="px-2 py-1">{[d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-2 py-1"><span className={`inline-block text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${STAGE_COLORS[d.stage]}`}>{d.stage.replace(/_/g, " ")}</span></td>
                  <td className="px-2 py-1">{d.referralSource ?? "—"}</td>
                  <td className="px-2 py-1 text-zinc-500">{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td className="px-2 py-1 text-right"><a href={`/deals/${d.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300">Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Quotes">
        {quoteRows.length === 0 ? (<p className="text-xs text-zinc-500 font-body">No quotes.</p>) : (
          <table className="w-full text-xs font-body">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500"><th className="px-2 py-1">Quote #</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Stage</th><th className="px-2 py-1 text-right">Total</th><th className="px-2 py-1">Created</th><th className="px-2 py-1"></th></tr></thead>
            <tbody className="text-zinc-200">
              {quoteRows.map((q) => (
                <tr key={q.id} className="border-t border-white/5">
                  <td className="px-2 py-1 font-mono">{q.quoteNumber ?? q.id.slice(0, 8)}</td>
                  <td className="px-2 py-1">{q.status}</td>
                  <td className="px-2 py-1">{q.workflowStage.replace(/_/g, " ")}</td>
                  <td className="px-2 py-1 text-right">{fmt(q.grandTotal)}</td>
                  <td className="px-2 py-1 text-zinc-500">{new Date(q.createdAt).toLocaleDateString()}</td>
                  <td className="px-2 py-1 text-right"><a href={`/quotes/${q.id}`} className="text-[11px] text-amber-400 hover:text-amber-300">Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Work orders">
        {woRows.length === 0 ? (<p className="text-xs text-zinc-500 font-body">No work orders.</p>) : (
          <table className="w-full text-xs font-body">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500"><th className="px-2 py-1">WO #</th><th className="px-2 py-1">Stage</th><th className="px-2 py-1">Parts consumed</th><th className="px-2 py-1">Created</th><th className="px-2 py-1"></th></tr></thead>
            <tbody className="text-zinc-200">
              {woRows.map((w) => (
                <tr key={w.id} className="border-t border-white/5">
                  <td className="px-2 py-1 font-mono">{w.woNumber ?? w.id.slice(0, 8)}</td>
                  <td className="px-2 py-1">{w.status.replace(/_/g, " ")}</td>
                  <td className="px-2 py-1">{w.partsConsumed ? "Yes" : "No"}</td>
                  <td className="px-2 py-1 text-zinc-500">{new Date(w.createdAt).toLocaleDateString()}</td>
                  <td className="px-2 py-1 text-right">{w.quoteId ? (<a href={`/quotes/${w.quoteId}`} className="text-[11px] text-amber-400 hover:text-amber-300">Open quote</a>) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-display font-bold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mt-1">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-2">
      <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}
