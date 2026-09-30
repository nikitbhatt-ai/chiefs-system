import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db } from "@/db";
import { deals, customers, users, dealActivity, partners, partnerContacts, dealCredentials, quotes, customerDocuments, dealTasks, customerMessages, workOrders } from "@/db/schema";
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
import { docForPipeline } from "@/lib/documentTemplates";
import { categoryForKind } from "@/lib/customerDocuments";
import { parseMentions } from "@/lib/mentions";
import { notify, notifyMany } from "@/lib/notifications";
import { loadStageMapping, mapCrmToWorkflow, WORKFLOW_STAGE_LABELS } from "@/lib/stageMapping";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const TABS = ["details", "activity", "documents", "tasks", "communication"] as const;
type Tab = (typeof TABS)[number];

export default async function DealEntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "details";

  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) notFound();

  const [customerRow, assigneeRow, activity, partnerRow, contactRow, credentials, dealQuotes, dealFiles, taskRows, messageRows, userRows, dealWorkOrders, stageMap] = await Promise.all([
    d.customerId ? db.select().from(customers).where(eq(customers.id, d.customerId)).limit(1) : Promise.resolve([]),
    d.assignedTo ? db.select().from(users).where(eq(users.id, d.assignedTo)).limit(1) : Promise.resolve([]),
    db.select().from(dealActivity).where(eq(dealActivity.dealId, id)).orderBy(desc(dealActivity.createdAt)),
    d.partnerId ? db.select().from(partners).where(eq(partners.id, d.partnerId)).limit(1) : Promise.resolve([]),
    d.partnerContactId ? db.select().from(partnerContacts).where(eq(partnerContacts.id, d.partnerContactId)).limit(1) : Promise.resolve([]),
    db.select().from(dealCredentials).where(eq(dealCredentials.dealId, id)).orderBy(asc(dealCredentials.createdAt)),
    db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber, workflowStage: quotes.workflowStage }).from(quotes).where(eq(quotes.dealId, id)).orderBy(desc(quotes.updatedAt)),
    db.select().from(customerDocuments).where(and(eq(customerDocuments.associatedDealId, id), eq(customerDocuments.isCurrentVersion, true))).orderBy(desc(customerDocuments.uploadedAt)),
    db.select().from(dealTasks).where(eq(dealTasks.dealId, id)).orderBy(asc(dealTasks.completedAt), asc(dealTasks.dueDate)),
    db.select().from(customerMessages).where(eq(customerMessages.dealId, id)).orderBy(desc(customerMessages.createdAt)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.active, true)),
    db.select({ id: workOrders.id, woNumber: workOrders.woNumber, status: workOrders.status }).from(workOrders).where(eq(workOrders.dealId, id)).orderBy(desc(workOrders.updatedAt)).limit(1),
    loadStageMapping(),
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
    const parentIdRaw = String(formData.get("parentId") ?? "").trim();
    const parentId = parentIdRaw || null;

    const allUsers = await db
      .select({ id: users.id, username: users.username, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.active, true));
    const { userIds: mentionedIds } = parseMentions(body, allUsers);

    const [inserted] = await db
      .insert(dealActivity)
      .values({
        dealId: id,
        authorId: session.user.id,
        kind: parentId ? "reply" : "note",
        body,
        parentId,
        mentions: mentionedIds,
      })
      .returning({ id: dealActivity.id });

    const customerName = customer?.name ?? "Deal";
    const link = `/deals/${id}?tab=activity`;
    const actorName = (session.user as { name?: string; email?: string }).name ?? (session.user as { email?: string }).email ?? "Someone";

    if (mentionedIds.length > 0) {
      await notifyMany(
        mentionedIds.filter((uid) => uid !== session.user!.id),
        {
          kind: "mention",
          title: `${actorName} mentioned you on ${customerName}`,
          body: body.slice(0, 200),
          link,
          dealId: id,
          actorId: session.user.id,
        },
      );
    }

    if (parentId) {
      const [parent] = await db
        .select({ authorId: dealActivity.authorId })
        .from(dealActivity)
        .where(eq(dealActivity.id, parentId));
      if (parent?.authorId && parent.authorId !== session.user.id && !mentionedIds.includes(parent.authorId)) {
        await notify(parent.authorId, {
          kind: "comment_reply",
          title: `${actorName} replied to your comment on ${customerName}`,
          body: body.slice(0, 200),
          link,
          dealId: id,
          actorId: session.user.id,
        });
      }
    }

    void inserted;
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

  async function uploadDocument(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    if (!d.customerId) {
      throw new Error("Cannot upload a document until the deal has a customer.");
    }
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    const kind = String(formData.get("kind") ?? "").trim() || "deal_attachment";
    const category = categoryForKind(kind);
    const blob = await put(`customers/${d.customerId}/${Date.now()}-${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    });
    // Versioning: if a same-named, same-category, same-deal doc already exists,
    // mark it stale and parent the new row to its lineage root.
    const [prior] = await db
      .select({ id: customerDocuments.id, version: customerDocuments.version, parentDocumentId: customerDocuments.parentDocumentId })
      .from(customerDocuments)
      .where(and(
        eq(customerDocuments.customerId, d.customerId),
        eq(customerDocuments.category, category),
        eq(customerDocuments.fileName, file.name),
        eq(customerDocuments.isCurrentVersion, true),
      ))
      .limit(1);
    let version = 1;
    let parentDocumentId: string | null = null;
    if (prior) {
      version = prior.version + 1;
      parentDocumentId = prior.parentDocumentId ?? prior.id;
      await db.update(customerDocuments).set({ isCurrentVersion: false }).where(eq(customerDocuments.id, prior.id));
    }
    await db.insert(customerDocuments).values({
      customerId: d.customerId,
      category,
      fileName: file.name,
      blobUrl: blob.url,
      mimeType: file.type || null,
      sizeBytes: file.size || null,
      uploadedBy: session.user.id,
      associatedDealId: id,
      kind,
      version,
      isCurrentVersion: true,
      parentDocumentId,
    });
    await db.insert(dealActivity).values({
      dealId: id,
      authorId: session.user.id,
      kind: "document_uploaded",
      body: `Uploaded ${file.name}${version > 1 ? ` (v${version})` : ""}${kind && kind !== "deal_attachment" ? ` — ${kind}` : ""}`,
    });
    revalidatePath(`/deals/${id}`);
    revalidatePath(`/crm/${d.customerId}`);
  }

  async function deleteFile(formData: FormData) {
    "use server";
    const fileId = String(formData.get("fileId") ?? "");
    if (!fileId) return;
    await db.delete(customerDocuments).where(eq(customerDocuments.id, fileId));
    revalidatePath(`/deals/${id}`);
    if (d.customerId) revalidatePath(`/crm/${d.customerId}`);
  }

  async function createTask(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    const dueRaw = String(formData.get("dueDate") ?? "").trim();
    const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;
    await db.insert(dealTasks).values({
      dealId: id,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      assignedTo,
      department: String(formData.get("department") ?? "").trim() || null,
      dueDate: dueRaw ? new Date(dueRaw) : null,
      createdBy: session.user.id,
    });
    if (assignedTo && assignedTo !== session.user.id) {
      const actorName = (session.user as { name?: string; email?: string }).name ?? (session.user as { email?: string }).email ?? "Someone";
      const customerName = customer?.name ?? "a deal";
      await notify(assignedTo, {
        kind: "task_assigned",
        title: `${actorName} assigned you a task on ${customerName}`,
        body: title,
        link: `/deals/${id}?tab=tasks`,
        dealId: id,
        actorId: session.user.id,
      });
    }
    revalidatePath(`/deals/${id}`);
  }

  async function toggleTaskComplete(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const taskId = String(formData.get("taskId") ?? "");
    const currentlyCompleted = formData.get("currentlyCompleted") === "1";
    if (!taskId) return;
    await db
      .update(dealTasks)
      .set({
        completedAt: currentlyCompleted ? null : new Date(),
        completedBy: currentlyCompleted ? null : session.user.id,
      })
      .where(eq(dealTasks.id, taskId));
    revalidatePath(`/deals/${id}`);
  }

  async function deleteTask(formData: FormData) {
    "use server";
    const taskId = String(formData.get("taskId") ?? "");
    if (!taskId) return;
    await db.delete(dealTasks).where(eq(dealTasks.id, taskId));
    revalidatePath(`/deals/${id}`);
  }

  async function logMessage(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const channel = String(formData.get("channel") ?? "").trim();
    const direction = String(formData.get("direction") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    if (!channel || !direction || !body) return;
    await db.insert(customerMessages).values({
      dealId: id,
      channel,
      direction,
      subject: String(formData.get("subject") ?? "").trim() || null,
      body,
      sentBy: session.user.id,
    });
    revalidatePath(`/deals/${id}`);
  }

  async function deleteMessage(formData: FormData) {
    "use server";
    const msgId = String(formData.get("msgId") ?? "");
    if (!msgId) return;
    await db.delete(customerMessages).where(eq(customerMessages.id, msgId));
    revalidatePath(`/deals/${id}`);
  }

  const pipeline = getPipeline(d.pipeline);
  const tracks: Track[] = [salesTrack(pipeline, d.stage)];
  if (pipeline.hardGate) tracks.push(credentialTrack(credentials));
  tracks.push(buildTrack(latestQuote?.workflowStage));

  return (
    <AppShell title={`Deal ${d.id.slice(0, 8)}`} subtitle={`${pipeline.label} pipeline`}>
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-4">
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

      <nav className="flex flex-wrap gap-1 border-b border-white/5">
        {TABS.map((t) => (
          <a
            key={t}
            href={`/deals/${id}?tab=${t}`}
            className={`text-xs font-body uppercase tracking-wider px-3 py-2 -mb-px border-b-2 transition-colors ${
              tab === t
                ? "border-amber-400 text-white"
                : "border-transparent text-zinc-500 hover:text-white"
            }`}
          >
            {t}
            {t === "tasks" && taskRows.filter((tk) => !tk.completedAt).length > 0 && (
              <span className="ml-1.5 inline-block text-[9px] rounded-full bg-amber-500 text-black px-1.5 py-0.5">
                {taskRows.filter((tk) => !tk.completedAt).length}
              </span>
            )}
          </a>
        ))}
      </nav>

      {tab === "details" && (<>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface border border-white/5 rounded-lg p-4 md:col-span-2 space-y-2 text-xs font-body text-zinc-300">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className={`inline-block text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 ${STAGE_COLORS[d.stage] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"}`}>{stageLabel(d.stage)}</span>
            {(() => {
              const wo = dealWorkOrders[0] ?? null;
              const liveStage = wo?.status ?? mapCrmToWorkflow(d.stage, stageMap);
              if (!liveStage) {
                return (
                  <span className="text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 bg-zinc-500/10 text-zinc-500 border-zinc-500/20">
                    Workflow · pre-shop
                  </span>
                );
              }
              const label = WORKFLOW_STAGE_LABELS[liveStage] ?? liveStage;
              return (
                <Link
                  href="/workflow"
                  className="inline-block text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 bg-blue-500/10 text-blue-300 border-blue-500/30 hover:bg-blue-500/20"
                  title={wo ? `Linked work order ${wo.woNumber ?? wo.id.slice(0, 8)}` : "No work order yet — derived from CRM stage"}
                >
                  Workflow · {label}{wo ? "" : " (pending)"}
                </Link>
              );
            })()}
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
        <div className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-2 gap-2 text-center">
          <Stat label="Activity" value={activity.length} />
          <Stat label="Open tasks" value={taskRows.filter((tk) => !tk.completedAt).length} />
        </div>
      </div>
      {pipeline.hardGate ? (
        <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
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
                            <SubmitButton className="text-[10px] text-green-400 hover:text-green-300">Verify</SubmitButton>
                          </form>
                        )}
                        <form action={deleteCredential} className="inline">
                          <input type="hidden" name="credId" value={c.id} />
                          <SubmitButton className="text-[10px] text-zinc-500 hover:text-red-400">Delete</SubmitButton>
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
              <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Add credential</SubmitButton>
            </div>
          </form>
        </div>
      ) : null}
      </>)}

      {tab === "documents" && (() => {
        const docSpec = docForPipeline(pipeline.slug);
        const pipelineDocs = docSpec
          ? dealFiles.filter((f) => f.kind === docSpec.slug)
          : [];
        const otherDocs = docSpec
          ? dealFiles.filter((f) => f.kind !== docSpec.slug)
          : dealFiles;
        const printHref = docSpec
          ? `/deals/${d.id}/documents/${docSpec.slug.replace(/^pipeline_doc:/, "")}/print`
          : null;
        return (
          <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Documents</h3>
              {docSpec ? (
                <span className="text-[10px] font-body text-zinc-500">
                  {pipeline.label} requires {docSpec.label} before {stageLabel(docSpec.requiredBeforeStage)}.
                </span>
              ) : null}
            </div>
            {docSpec ? (
              <div className="bg-black/30 border border-white/5 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-body font-semibold text-white">{docSpec.label}</div>
                    <div className="text-[11px] text-zinc-400 font-body">{docSpec.description}</div>
                  </div>
                  {pipelineDocs.length > 0 ? (
                    <span className="text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 bg-green-500/10 text-green-300 border-green-500/30">
                      {pipelineDocs.length} attached
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 bg-amber-500/10 text-amber-300 border-amber-500/30">
                      Not attached
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {printHref ? (
                    <a href={printHref} target="_blank" className="text-[11px] text-amber-400 hover:text-amber-300 font-body">
                      Generate blank form →
                    </a>
                  ) : null}
                  <form action={uploadDocument} encType="multipart/form-data" className="flex items-center gap-2">
                    <input type="hidden" name="kind" value={docSpec.slug} />
                    <input type="file" name="file" required className="text-[11px] font-body text-zinc-300 file:bg-black/40 file:border file:border-white/10 file:rounded file:px-2 file:py-1 file:text-zinc-300 file:mr-2" />
                    <SubmitButton className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded px-3 py-1">
                      Upload signed copy
                    </SubmitButton>
                  </form>
                </div>
                {pipelineDocs.length > 0 ? (
                  <ul className="pt-2 border-t border-white/5 space-y-1">
                    {pipelineDocs.map((f) => (
                      <li key={f.id} className="flex items-center justify-between text-[11px] font-body">
                        <a href={f.blobUrl} target="_blank" className="text-zinc-200 hover:text-white truncate">{f.fileName}</a>
                        <div className="flex items-center gap-3 text-zinc-500">
                          <span>{new Date(f.uploadedAt).toLocaleDateString()}</span>
                          <form action={deleteFile} className="inline">
                            <input type="hidden" name="fileId" value={f.id} />
                            <SubmitButton className="hover:text-red-400">Delete</SubmitButton>
                          </form>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-body text-zinc-500">Other attachments</span>
                <form action={uploadDocument} encType="multipart/form-data" className="flex items-center gap-2">
                  <input type="hidden" name="kind" value="deal_attachment" />
                  <input type="file" name="file" required className="text-[11px] font-body text-zinc-300 file:bg-black/40 file:border file:border-white/10 file:rounded file:px-2 file:py-1 file:text-zinc-300 file:mr-2" />
                  <SubmitButton className="text-[11px] font-body text-amber-400 hover:text-amber-300">+ Upload</SubmitButton>
                </form>
              </div>
              {otherDocs.length === 0 ? (
                <p className="text-[11px] text-zinc-500 font-body">No other attachments.</p>
              ) : (
                <ul className="space-y-1">
                  {otherDocs.map((f) => (
                    <li key={f.id} className="flex items-center justify-between text-[11px] font-body">
                      <a href={f.blobUrl} target="_blank" className="text-zinc-200 hover:text-white truncate">{f.fileName}</a>
                      <div className="flex items-center gap-3 text-zinc-500">
                        <span>{new Date(f.uploadedAt).toLocaleDateString()}</span>
                        <form action={deleteFile} className="inline">
                          <input type="hidden" name="fileId" value={f.id} />
                          <SubmitButton className="hover:text-red-400">Delete</SubmitButton>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })()}

      {tab === "activity" && (() => {
        // Build a thread tree: top-level rows (parentId == null) ordered newest
        // first; replies hung under their parent in chronological order.
        const byParent = new Map<string, typeof activity>();
        const roots: typeof activity = [];
        for (const a of activity) {
          if (a.parentId) {
            const arr = byParent.get(a.parentId) ?? [];
            arr.push(a);
            byParent.set(a.parentId, arr);
          } else {
            roots.push(a);
          }
        }
        for (const [, arr] of byParent) arr.sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
        const renderNote = (a: (typeof activity)[number], depth: number) => {
          const replies = byParent.get(a.id) ?? [];
          const mentions = Array.isArray(a.mentions) ? (a.mentions as string[]) : [];
          return (
            <li key={a.id} className={`bg-black/30 border border-white/5 rounded-md p-2.5 text-xs font-body ${depth > 0 ? "ml-4 md:ml-6" : ""}`}>
              <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                <span>{a.kind} · {(a.authorId && authorMap.get(a.authorId)) ?? "system"} · {new Date(a.createdAt).toLocaleString()}</span>
              </div>
              {a.body && (<div className="whitespace-pre-wrap text-white">{a.body}</div>)}
              {mentions.length > 0 && (
                <div className="mt-1 text-[10px] text-amber-300 font-body">
                  @{mentions.map((m) => authorMap.get(m) ?? "user").join(", @")}
                </div>
              )}
              {(a.kind === "note" || a.kind === "reply") && (
                <details className="mt-2">
                  <summary className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-amber-300 cursor-pointer">Reply</summary>
                  <form action={postNote} className="flex gap-2 mt-1.5">
                    <input type="hidden" name="parentId" value={a.id} />
                    <textarea name="body" rows={2} placeholder="Reply… @mention someone with @username" className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-xs font-body text-white placeholder:text-zinc-500" />
                    <SubmitButton className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1 self-start">Post reply</SubmitButton>
                  </form>
                </details>
              )}
              {replies.length > 0 && (
                <ul className="space-y-2 mt-2">
                  {replies.map((r) => renderNote(r, depth + 1))}
                </ul>
              )}
            </li>
          );
        };

        return (
          <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Activity feed</h3>
            <form action={postNote} className="flex gap-2">
              <textarea name="body" rows={2} placeholder="Post an internal note (@mention someone with @username)…" className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs font-body text-white placeholder:text-zinc-500" />
              <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 self-start">Post</SubmitButton>
            </form>
            {roots.length === 0 ? (
              <p className="text-xs text-zinc-500 font-body">No activity yet.</p>
            ) : (
              <ul className="space-y-2">{roots.map((a) => renderNote(a, 0))}</ul>
            )}
          </div>
        );
      })()}

      {tab === "tasks" && (
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Tasks</h3>
        <form action={createTask} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <input name="title" required placeholder="Task title *" className="md:col-span-2 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500" />
          <select name="assignedTo" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white">
            <option value="">— Assignee —</option>
            {userRows.map((u) => (<option key={u.id} value={u.id}>{u.name ?? u.email}</option>))}
          </select>
          <select name="department" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white">
            <option value="">— Dept —</option>
            <option value="sales">Sales</option>
            <option value="shop">Shop</option>
            <option value="warehouse">Warehouse</option>
            <option value="finance">Finance</option>
            <option value="admin">Admin</option>
          </select>
          <input name="dueDate" type="date" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white" />
          <textarea name="description" placeholder="Description (optional)" rows={2} className="md:col-span-4 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500" />
          <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Add task</SubmitButton>
        </form>
        {taskRows.length === 0 ? (
          <p className="text-xs text-zinc-500 font-body">No tasks.</p>
        ) : (
          <ul className="space-y-1">
            {taskRows.map((t) => {
              const done = !!t.completedAt;
              const overdue = !done && t.dueDate && new Date(t.dueDate).getTime() < Date.now();
              return (
                <li key={t.id} className={`flex items-start gap-3 text-xs font-body bg-black/30 border border-white/5 rounded-md p-2.5 ${done ? "opacity-60" : ""}`}>
                  <form action={toggleTaskComplete} className="pt-0.5">
                    <input type="hidden" name="taskId" value={t.id} />
                    <input type="hidden" name="currentlyCompleted" value={done ? "1" : "0"} />
                    <SubmitButton aria-label="Toggle complete" className={`w-4 h-4 rounded border ${done ? "bg-green-500 border-green-400" : "bg-black/40 border-white/30 hover:border-amber-400"}`}>
                      {done && (<span className="text-black text-[10px] leading-none">✓</span>)}
                    </SubmitButton>
                  </form>
                  <div className="flex-1 min-w-0">
                    <div className={`text-white ${done ? "line-through" : ""}`}>{t.title}</div>
                    {t.description && (<div className="text-zinc-400 text-[11px] mt-0.5 whitespace-pre-wrap">{t.description}</div>)}
                    <div className="text-[10px] text-zinc-500 mt-1 flex flex-wrap gap-3">
                      {t.assignedTo && <span>→ {userRows.find((u) => u.id === t.assignedTo)?.name ?? userRows.find((u) => u.id === t.assignedTo)?.email ?? "—"}</span>}
                      {t.department && <span className="uppercase tracking-wider">{t.department}</span>}
                      {t.dueDate && <span className={overdue ? "text-red-300" : ""}>Due {new Date(t.dueDate).toLocaleDateString()}{overdue ? " (overdue)" : ""}</span>}
                      {done && t.completedAt && <span className="text-green-300">Done {new Date(t.completedAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <form action={deleteTask}>
                    <input type="hidden" name="taskId" value={t.id} />
                    <SubmitButton className="text-[10px] text-zinc-500 hover:text-red-400">Delete</SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}

      {tab === "communication" && (
      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Communication log</h3>
        <form action={logMessage} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <select name="channel" required defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white">
            <option value="" disabled>— Channel * —</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="in_person">In person</option>
            <option value="meeting">Meeting</option>
            <option value="other">Other</option>
          </select>
          <select name="direction" required defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white">
            <option value="" disabled>— Direction * —</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
          <input name="subject" placeholder="Subject (optional)" className="md:col-span-2 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500" />
          <textarea name="body" required rows={2} placeholder="Body / notes *" className="md:col-span-4 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white placeholder:text-zinc-500" />
          <SubmitButton className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Log message</SubmitButton>
        </form>
        {messageRows.length === 0 ? (
          <p className="text-xs text-zinc-500 font-body">No communication logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {messageRows.map((m) => (
              <li key={m.id} className="bg-black/30 border border-white/5 rounded-md p-2.5 text-xs font-body">
                <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                  <span>
                    {m.channel} · {m.direction} · {(m.sentBy && (userRows.find((u) => u.id === m.sentBy)?.name ?? userRows.find((u) => u.id === m.sentBy)?.email)) ?? "—"} · {new Date(m.createdAt).toLocaleString()}
                  </span>
                  <form action={deleteMessage} className="inline">
                    <input type="hidden" name="msgId" value={m.id} />
                    <SubmitButton className="text-zinc-500 hover:text-red-400">Delete</SubmitButton>
                  </form>
                </div>
                {m.subject && (<div className="text-white font-semibold">{m.subject}</div>)}
                {m.body && (<div className="whitespace-pre-wrap text-zinc-200 mt-1">{m.body}</div>)}
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (<div><span className="text-zinc-500 uppercase tracking-wider text-[10px] mr-2">{label}:</span>{value}</div>);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (<div><div className="text-2xl font-display font-bold text-white">{value}</div><div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mt-1">{label}</div></div>);
}
