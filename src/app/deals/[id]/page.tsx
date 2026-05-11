import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users, dealActivity, partners, partnerContacts, dealCredentials, quotes } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { STAGE_COLORS, getPipeline, stageLabel } from "@/lib/pipelines";
import {
  CREDENTIAL_TYPES,
  RESTRICTION_CATEGORIES,
  STATUS_COLORS as CRED_STATUS_COLORS,
  STATUS_LABELS as CRED_STATUS_LABELS,
  credentialStatus,
} from "@/lib/credentials";
import {
  TRACK_STAGE_COLORS,
  buildTrack,
  credentialTrack,
  salesTrack,
  type Track,
} from "@/lib/tracks";

export const dynamic = "force-dynamic";

export default async function DealEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) notFound();

  const [customerRow, assigneeRow, activity, partnerRow, contactRow, credentials, dealQuotes] = await Promise.all([
    d.customerId ? db.select().from(customers).where(eq(customers.id, d.customerId)).limit(1) : Promise.resolve([]),
    d.assignedTo ? db.select().from(users).where(eq(users.id, d.assignedTo)).limit(1) : Promise.resolve([]),
    db.select().from(dealActivity).where(eq(dealActivity.dealId, id)).orderBy(desc(dealActivity.createdAt)),
    d.partnerId ? db.select().from(partners).where(eq(partners.id, d.partnerId)).limit(1) : Promise.resolve([]),
    d.partnerContactId ? db.select().from(partnerContacts).where(eq(partnerContacts.id, d.partnerContactId)).limit(1) : Promise.resolve([]),
    db.select().from(dealCredentials).where(eq(dealCredentials.dealId, id)).orderBy(asc(dealCredentials.createdAt)),
    db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber, workflowStage: quotes.workflowStage }).from(quotes).where(eq(quotes.dealId, id)).orderBy(desc(quotes.updatedAt)),
  ]);
  const customer = customerRow[0] ?? null;
  const assignee = assigneeRow[0] ?? null;
  const partner = partnerRow[0] ?? null;
  const contact = contactRow[0] ?? null;
  const latestQuote = dealQuotes[0] ?? null;

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

  async function addCredential(formData: FormData) {
    "use server";
    const credentialType = String(formData.get("credentialType") ?? "").trim();
    if (credentialType !== "LE" && credentialType !== "Generic") return;
    const issuedRaw = String(formData.get("issuedDate") ?? "").trim();
    const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
    const restricted = formData
      .getAll("restrictedEquipment")
      .map((v) => String(v))
      .filter(Boolean);
    await db.insert(dealCredentials).values({
      dealId: id,
      credentialType,
      credentialNumber: String(formData.get("credentialNumber") ?? "").trim() || null,
      issuingAuthority: String(formData.get("issuingAuthority") ?? "").trim() || null,
      issuedDate: issuedRaw ? new Date(issuedRaw) : null,
      expiresAt: expiresRaw ? new Date(expiresRaw) : null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      restrictedEquipment: restricted.length ? restricted : null,
    });
    const session = await auth();
    if (session?.user) {
      await db.insert(dealActivity).values({
        dealId: id,
        authorId: session.user.id,
        kind: "credential_added",
        body: `Added ${credentialType} credential` + (restricted.length ? ` covering ${restricted.join(", ")}` : ""),
      });
    }
    revalidatePath(`/deals/${id}`);
  }

  async function verifyCredential(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const credId = String(formData.get("credId") ?? "");
    if (!credId) return;
    await db
      .update(dealCredentials)
      .set({ verifiedAt: new Date(), verifiedBy: session.user.id, updatedAt: new Date() })
      .where(eq(dealCredentials.id, credId));
    await db.insert(dealActivity).values({
      dealId: id,
      authorId: session.user.id,
      kind: "credential_verified",
      body: "Verified credential",
    });
    revalidatePath(`/deals/${id}`);
  }

  async function deleteCredential(formData: FormData) {
    "use server";
    const credId = String(formData.get("credId") ?? "");
    if (!credId) return;
    await db.delete(dealCredentials).where(eq(dealCredentials.id, credId));
    revalidatePath(`/deals/${id}`);
  }

  const pipeline = getPipeline(d.pipeline);
  const tracks: Track[] = [salesTrack(pipeline, d.stage)];
  if (pipeline.hardGate) tracks.push(credentialTrack(credentials));
  tracks.push(buildTrack(latestQuote?.workflowStage));

  return (
    <AppShell title={`Deal ${d.id.slice(0, 8)}`} subtitle={`${pipeline.label} pipeline`}>
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Parallel tracks</h3>
          {latestQuote ? (
            <a href={`/quotes/${latestQuote.id}`} className="text-[11px] text-amber-400 hover:text-amber-300 font-body">
              Open {latestQuote.quoteNumber ?? "quote"} →
            </a>
          ) : null}
        </div>
        {tracks.map((track) => {
          const currentIdx = track.stages.findIndex((s) => s.value === track.currentValue);
          return (
            <div key={track.slug} className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider font-body font-semibold text-zinc-300">
                  {track.label} track
                </span>
                <span className="text-[10px] text-zinc-500 font-body">{track.description}</span>
              </div>
              <ol className="flex flex-wrap items-center gap-1.5 text-[10px] font-body uppercase tracking-wider">
                {track.stages.map((stage, idx) => {
                  const isCurrent = stage.value === track.currentValue;
                  const isPast = currentIdx > -1 && idx < currentIdx;
                  let cls: string;
                  if (isCurrent) {
                    cls = stage.status
                      ? TRACK_STAGE_COLORS[stage.status]
                      : track.slug === "sales"
                        ? STAGE_COLORS[stage.value] ?? TRACK_STAGE_COLORS.neutral
                        : TRACK_STAGE_COLORS.neutral;
                  } else if (isPast) {
                    cls = "bg-white/10 text-zinc-300 border-white/10";
                  } else {
                    cls = "bg-black/20 text-zinc-600 border-white/5";
                  }
                  return (
                    <li key={stage.value} className="flex items-center gap-1.5">
                      {idx > 0 ? <span className="text-zinc-700">→</span> : null}
                      <span className={`inline-block rounded border px-2 py-0.5 ${cls}`}>{stage.label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 md:col-span-2 space-y-2 text-xs font-body text-zinc-300">
          <div className="flex items-center gap-3 mb-2">
            <span className={`inline-block text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 ${STAGE_COLORS[d.stage] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"}`}>{stageLabel(d.stage)}</span>
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
      {pipeline.hardGate ? (
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Credentials</h3>
            <span className="text-[10px] font-body text-zinc-500">
              {pipeline.label} requires a verified credential before advancing past {stageLabel(pipeline.hardGate)}.
            </span>
          </div>
          {credentials.length === 0 ? (
            <p className="text-[11px] text-amber-300 font-body bg-amber-500/5 border border-amber-500/30 rounded p-2.5">
              No credentials on file. The deal cannot advance past {stageLabel(pipeline.hardGate)} until a credential is added and verified.
            </p>
          ) : (
            <ul className="space-y-2">
              {credentials.map((c) => {
                const status = credentialStatus(c);
                const restricted = Array.isArray(c.restrictedEquipment) ? (c.restrictedEquipment as string[]) : [];
                return (
                  <li key={c.id} className="bg-black/30 border border-white/5 rounded-md p-2.5 text-[11px] font-body grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                    <div>
                      <div className="text-white font-semibold">{c.credentialType === "LE" ? "Law Enforcement" : "Generic"}</div>
                      <div className="text-zinc-400">{c.credentialNumber ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 uppercase tracking-wider text-[9px]">Authority</div>
                      <div className="text-zinc-300">{c.issuingAuthority ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 uppercase tracking-wider text-[9px]">Dates</div>
                      <div className="text-zinc-300">
                        {c.issuedDate ? new Date(c.issuedDate).toLocaleDateString() : "—"}
                        {" → "}
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                      </div>
                    </div>
                    <div className="flex flex-col items-start md:items-end gap-1">
                      <span className={`inline-block text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 ${CRED_STATUS_COLORS[status]}`}>
                        {CRED_STATUS_LABELS[status]}
                      </span>
                      <div className="flex gap-2">
                        {!c.verifiedAt && (
                          <form action={verifyCredential} className="inline">
                            <input type="hidden" name="credId" value={c.id} />
                            <button type="submit" className="text-[10px] text-green-400 hover:text-green-300">Verify</button>
                          </form>
                        )}
                        <form action={deleteCredential} className="inline">
                          <input type="hidden" name="credId" value={c.id} />
                          <button type="submit" className="text-[10px] text-zinc-500 hover:text-red-400">Delete</button>
                        </form>
                      </div>
                    </div>
                    {restricted.length > 0 && (
                      <div className="md:col-span-4 text-[10px] text-zinc-500 uppercase tracking-wider">
                        Covers: <span className="text-zinc-300 normal-case tracking-normal">
                          {restricted
                            .map((r) => RESTRICTION_CATEGORIES.find((rc) => rc.value === r)?.label ?? r)
                            .join(", ")}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <form action={addCredential} className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-white/5">
            <div className="md:col-span-3 text-[10px] uppercase tracking-wider text-zinc-500 font-body">Add credential</div>
            <select name="credentialType" required defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white">
              <option value="" disabled>— Type * —</option>
              {CREDENTIAL_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
            <input name="credentialNumber" placeholder="Credential / badge #" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500" />
            <input name="issuingAuthority" placeholder="Issuing authority" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500" />
            <label className="text-[10px] text-zinc-500 font-body">Issued
              <input name="issuedDate" type="date" className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white" />
            </label>
            <label className="text-[10px] text-zinc-500 font-body">Expires
              <input name="expiresAt" type="date" className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white" />
            </label>
            <input name="notes" placeholder="Notes" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500" />
            <fieldset className="md:col-span-3 border border-white/5 rounded-md p-2">
              <legend className="text-[10px] uppercase tracking-wider text-zinc-500 font-body px-1">Restricted equipment this credential covers</legend>
              <div className="flex flex-wrap gap-2 mt-1">
                {RESTRICTION_CATEGORIES.map((r) => (
                  <label key={r.value} className="text-[11px] font-body text-zinc-300 flex items-center gap-1.5">
                    <input type="checkbox" name="restrictedEquipment" value={r.value} className="accent-amber-500" />
                    {r.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="md:col-span-3 flex justify-end">
              <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Add credential</button>
            </div>
          </form>
        </div>
      ) : null}

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
