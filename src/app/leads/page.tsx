import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, lookups, partners, partnerContacts } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { NewLeadForm } from "./NewLeadForm";
import { convertLeadAction, deleteLeadAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  contacted: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  converted: "bg-green-500/10 text-green-300 border-green-500/30",
  lost: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

export default async function LeadsPage() {
  const [rows, sources, subSources, samesRow] = await Promise.all([
    db.select().from(leads).orderBy(desc(leads.createdAt)),
    db.select({ id: lookups.id, value: lookups.value, parentId: lookups.parentId }).from(lookups).where(and(eq(lookups.category, "source"), eq(lookups.active, true))).orderBy(asc(lookups.sortOrder), asc(lookups.value)),
    db.select({ id: lookups.id, value: lookups.value, parentId: lookups.parentId }).from(lookups).where(and(eq(lookups.category, "sub_source"), eq(lookups.active, true))).orderBy(asc(lookups.sortOrder), asc(lookups.value)),
    db.select().from(partners).where(eq(partners.name, "Sames")).limit(1),
  ]);
  const samesPartner = samesRow[0] ?? null;
  const samesContacts = samesPartner
    ? await db.select({ id: partnerContacts.id, name: partnerContacts.name, location: partnerContacts.location }).from(partnerContacts).where(and(eq(partnerContacts.partnerId, samesPartner.id), eq(partnerContacts.active, true))).orderBy(asc(partnerContacts.name))
    : [];

  return (
    <AppShell title="Leads" subtitle="Pipeline of prospects before they become customers">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">Add lead</h3>
        {sources.length === 0 ? (
          <div className="text-[11px] text-amber-300 font-body bg-amber-500/10 border border-amber-500/30 rounded p-3">
            No sources configured yet. An admin needs to add options in <a className="underline" href="/settings/lookups?category=source">Settings → Lookups → Lead sources</a>.
          </div>
        ) : (
          <NewLeadForm sources={sources} subSources={subSources} samesPartner={samesPartner ? { id: samesPartner.id, name: samesPartner.name } : null} samesContacts={samesContacts} />
        )}
      </div>
      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Pipeline</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5">Sub-source</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">No leads yet — add your first one above.</td></tr>
            ) : (
              rows.map((l) => (
                <tr key={l.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">{l.name}</td>
                  <td className="px-4 py-2.5 text-xs">{l.customerType ? l.customerType.replace(/_/g, " ") : "—"}</td>
                  <td className="px-4 py-2.5"><span className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[l.status]}`}>{l.status}</span></td>
                  <td className="px-4 py-2.5 text-xs">{l.source ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{l.subSource ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {l.status !== "converted" ? (<form action={convertLeadAction} className="inline"><input type="hidden" name="id" value={l.id} /><button type="submit" className="text-[11px] text-green-400 hover:text-green-300 font-body mr-3">Convert</button></form>) : null}
                    <a href={`/leads/${l.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3">Edit</a>
                    <form action={deleteLeadAction} className="inline"><input type="hidden" name="id" value={l.id} /><button type="submit" className="text-[11px] text-zinc-500 hover:text-red-400 font-body">Delete</button></form>
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
