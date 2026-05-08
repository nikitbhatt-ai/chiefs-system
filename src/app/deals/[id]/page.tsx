import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users, dealActivity, partners, partnerContacts } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  quote_sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  po_received: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_production: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  delivered: "bg-green-500/10 text-green-300 border-green-500/30",
  lost: "bg-red-500/10 text-red-300 border-red-500/30",
};

export default async function DealEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) notFound();

  const [customerRow, assigneeRow, activity, partnerRow, contactRow] = await Promise.all([
    d.customerId ? db.select().from(customers).where(eq(customers.id, d.customerId)).limit(1) : Promise.resolve([]),
    d.assignedTo ? db.select().from(users).where(eq(users.id, d.assignedTo)).limit(1) : Promise.resolve([]),
    db.select().from(dealActivity).where(eq(dealActivity.dealId, id)).orderBy(desc(dealActivity.createdAt)),
    d.partnerId ? db.select().from(partners).where(eq(partners.id, d.partnerId)).limit(1) : Promise.resolve([]),
    d.partnerContactId ? db.select().from(partnerContacts).where(eq(partnerContacts.id, d.partnerContactId)).limit(1) : Promise.resolve([]),
  ]);
  const customer = customerRow[0] ?? null;
  const assignee = assigneeRow[0] ?? null;
  const partner = partnerRow[0] ?? null;
  const contact = contactRow[0] ?? null;

  const authorIds = Array.from(new Set(activity.map((a) => a.authorId).filter(Boolean) as string[]));
  const authorMap = new Map<string, string>();
  if (authorIds.length) {
    const authorRows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
    for (const u of authorRows) authorMap.set(u.id, u.name ?? u.email);
  }

  async function postNote(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    await db.insert(dealActivity).values({ dealId: id, authorId: session.user.id, kind: "note", body });
    revalidatePath(`/deals/${id}`);
  }

  return (
    <AppShell title={`Deal ${d.id.slice(0, 8)}`} subtitle={d.pipeline ? `${d.pipeline.replace(/_/g, " ")} pipeline` : "No pipeline assigned"}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 md:col-span-2 space-y-2 text-xs font-body text-zinc-300">
          <div className="flex items-center gap-3 mb-2">
            <span className={`inline-block text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 ${STAGE_COLORS[d.stage] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"}`}>{d.stage.replace(/_/g, " ")}</span>
            {d.sourceLocked && (<span className="text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 bg-amber-500/10 text-amber-300 border-amber-500/30">🔒 Source locked</span>)}
          </div>
          <Row label="Customer" value={customer?.name ?? "—"} />
          <Row label="Assigned" value={assignee?.name ?? assignee?.email ?? d.salesRep ?? "—"} />
          <Row label="Vehicle" value={[d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ") || "—"} />
          <Row label="VIN" value={d.vin ?? "—"} />
          <Row label="Source" value={d.source ?? d.referralSource ?? "—"} />
          <Row label="Sub-source" value={d.subSource ?? "—"} />
          {partner && (<Row label="Partner" value={`${partner.name}${contact ? ` · ${contact.name}` : ""}`} />)}
          {d.notes && (<div className="pt-2 border-t border-white/5 text-zinc-400 whitespace-pre-wrap">{d.notes}</div>)}
          <div className="pt-2">
            <a href={`/deals/${d.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300 mr-3">Edit deal</a>
            <a href="/deals" className="text-[11px] text-zinc-400 hover:text-white">Back to list</a>
          </div>
        </div>
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-2 gap-2 text-center">
          <Stat label="Activity" value={activity.length} />
          <Stat label="Tasks" value={0} />
        </div>
      </div>
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Activity feed</h3>
        <form action={postNote} className="flex gap-2">
          <textarea name="body" rows={2} placeholder="Post an internal note (visible to staff)…" className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs font-body text-white placeholder:text-zinc-500" />
          <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 self-start">Post</button>
        </form>
        {activity.length === 0 ? (<p className="text-xs text-zinc-500 font-body">No activity yet.</p>) : (
          <ul className="space-y-2">
            {activity.map((a) => (
              <li key={a.id} className="bg-black/30 border border-white/5 rounded-md p-2.5 text-xs font-body">
                <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                  <span>{a.kind} · {(a.authorId && authorMap.get(a.authorId)) ?? "system"} · {new Date(a.createdAt).toLocaleString()}</span>
                </div>
                {a.body && (<div className="whitespace-pre-wrap text-white">{a.body}</div>)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (<div><span className="text-zinc-500 uppercase tracking-wider text-[10px] mr-2">{label}:</span>{value}</div>);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (<div><div className="text-2xl font-display font-bold text-white">{value}</div><div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mt-1">{label}</div></div>);
}
