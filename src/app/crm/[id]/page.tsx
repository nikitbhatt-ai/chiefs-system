import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, desc, and, gte, lte, ilike, inArray } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db } from "@/db";
import { customers, deals, quotes, workOrders, notes, users, customerDocuments, dealCredentials, dealActivity, documentAuditLog } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import {
  CUSTOMER_DOC_CATEGORIES,
  isValidCategory,
  categoryVisibleTo,
  visibleCategoriesFor,
} from "@/lib/customerDocuments";
import { upsertQuoteLink } from "@/lib/customerDocLinks";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

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

function fmtMoney(n: number) {
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function CustomerEntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; category?: string; deal?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) notFound();

  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role ?? null;
  const allowedCategories = visibleCategoriesFor(role);

  const docFilters = [eq(customerDocuments.customerId, id), eq(customerDocuments.isCurrentVersion, true)];
  // RBAC: only fetch documents in categories the user can read. Non-admins
  // who somehow request a restricted category via ?category= get an empty
  // list rather than an error.
  if (allowedCategories.length === 0) {
    // No allowed categories (unknown role or unauthenticated) — short-
    // circuit by adding an impossible filter.
    docFilters.push(eq(customerDocuments.id, "00000000-0000-0000-0000-000000000000"));
  } else {
    docFilters.push(inArray(customerDocuments.category, allowedCategories));
  }
  if (sp.q && sp.q.trim()) docFilters.push(ilike(customerDocuments.fileName, `%${sp.q.trim()}%`));
  if (sp.category && isValidCategory(sp.category)) docFilters.push(eq(customerDocuments.category, sp.category));
  if (sp.deal) docFilters.push(eq(customerDocuments.associatedDealId, sp.deal));
  if (sp.from) docFilters.push(gte(customerDocuments.uploadedAt, new Date(sp.from)));
  if (sp.to) docFilters.push(lte(customerDocuments.uploadedAt, new Date(sp.to)));

  const [dealRows, quoteRows, woRows, noteRows, docRows] = await Promise.all([
    db.select().from(deals).where(eq(deals.customerId, id)).orderBy(desc(deals.createdAt)),
    db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)),
    db.select().from(workOrders).where(eq(workOrders.customerId, id)).orderBy(desc(workOrders.createdAt)),
    db.select({ id: notes.id, body: notes.body, authorId: notes.authorId, createdAt: notes.createdAt }).from(notes).where(and(eq(notes.entityType, "customer"), eq(notes.entityId, id))).orderBy(desc(notes.createdAt)),
    db.select().from(customerDocuments).where(and(...docFilters)).orderBy(desc(customerDocuments.uploadedAt)),
  ]);

  const dealLabelMap = new Map(
    dealRows.map((d) => [d.id, [d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ") || d.id.slice(0, 8)]),
  );
  const dealIds = dealRows.map((d) => d.id);

  // Summary card data: credentials for expiring buckets, last activity timestamp.
  const [credentialRows, activityRows] = await Promise.all([
    dealIds.length
      ? db
          .select({
            id: dealCredentials.id,
            dealId: dealCredentials.dealId,
            credentialType: dealCredentials.credentialType,
            credentialNumber: dealCredentials.credentialNumber,
            expiresAt: dealCredentials.expiresAt,
            verifiedAt: dealCredentials.verifiedAt,
          })
          .from(dealCredentials)
          .where(inArray(dealCredentials.dealId, dealIds))
      : Promise.resolve([] as { id: string; dealId: string; credentialType: string; credentialNumber: string | null; expiresAt: Date | null; verifiedAt: Date | null }[]),
    dealIds.length
      ? db
          .select({ createdAt: dealActivity.createdAt })
          .from(dealActivity)
          .where(inArray(dealActivity.dealId, dealIds))
          .orderBy(desc(dealActivity.createdAt))
          .limit(1)
      : Promise.resolve([] as { createdAt: Date }[]),
  ]);

  const totalDeals = dealRows.length;
  const activeDeals = dealRows.filter((d) => d.stage !== "lost" && d.stage !== "delivered").length;
  const closedWonRevenue = quoteRows
    .filter((q) => q.status === "converted")
    .reduce((sum, q) => sum + Number(q.grandTotal ?? 0), 0);

  const lastContactCandidates: Date[] = [];
  if (dealRows[0]?.updatedAt) lastContactCandidates.push(new Date(dealRows[0].updatedAt));
  if (noteRows[0]?.createdAt) lastContactCandidates.push(new Date(noteRows[0].createdAt));
  if (docRows[0]?.uploadedAt) lastContactCandidates.push(new Date(docRows[0].uploadedAt));
  if (activityRows[0]?.createdAt) lastContactCandidates.push(new Date(activityRows[0].createdAt));
  const lastContact = lastContactCandidates.length
    ? new Date(Math.max(...lastContactCandidates.map((d) => d.getTime())))
    : null;

  // Bucket credentials by days-until-expiry. Already-expired land in their
  // own bucket so they surface in the warning banner even if past 0.
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  type ExpiringCred = (typeof credentialRows)[number] & { daysLeft: number };
  const expiringCreds: { expired: ExpiringCred[]; in30: ExpiringCred[]; in60: ExpiringCred[]; in90: ExpiringCred[] } = {
    expired: [],
    in30: [],
    in60: [],
    in90: [],
  };
  for (const cred of credentialRows) {
    if (!cred.expiresAt) continue;
    const daysLeft = Math.floor((new Date(cred.expiresAt).getTime() - now) / dayMs);
    const entry = { ...cred, daysLeft };
    if (daysLeft < 0) expiringCreds.expired.push(entry);
    else if (daysLeft <= 30) expiringCreds.in30.push(entry);
    else if (daysLeft <= 60) expiringCreds.in60.push(entry);
    else if (daysLeft <= 90) expiringCreds.in90.push(entry);
  }
  const hasExpiringCreds =
    expiringCreds.expired.length + expiringCreds.in30.length + expiringCreds.in60.length + expiringCreds.in90.length > 0;
  const docsByCategory = new Map<string, typeof docRows>();
  for (const cat of CUSTOMER_DOC_CATEGORIES) docsByCategory.set(cat.value, [] as typeof docRows);
  for (const d of docRows) {
    const list = docsByCategory.get(d.category) ?? [];
    list.push(d);
    docsByCategory.set(d.category, list);
  }

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

  // Generate a fresh draft quote pre-linked to this customer, then jump
  // straight into the editor. Mirrors createQuote on /quotes but skips
  // the customer-picker step since we already know the folder we're in.
  async function generateQuote() {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const quoteNumber = `Q-${Date.now().toString().slice(-7)}`;
    const [row] = await db
      .insert(quotes)
      .values({
        quoteNumber,
        customerId: id,
        status: "draft",
        lineItems: [],
        subtotal: "0",
        taxTotal: "0",
        grandTotal: "0",
      })
      .returning();
    // Best-effort folder auto-link (PR 9 pattern) — non-fatal.
    try {
      await upsertQuoteLink(row.id);
    } catch (err) {
      console.error("upsertQuoteLink failed:", err);
    }
    revalidatePath(`/crm/${id}`);
    revalidatePath("/quotes");
    redirect(`/quotes/${row.id}`);
  }

  async function uploadCustomerDoc(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    const requestedCategory = String(formData.get("category") ?? "");
    const category = isValidCategory(requestedCategory) ? requestedCategory : "misc";
    // RBAC write check. A user who can't see the category can't upload to it.
    const sRole = (s.user as { role?: string }).role;
    if (!categoryVisibleTo(category, sRole)) return;
    const associatedDealRaw = String(formData.get("associatedDealId") ?? "").trim();
    const associatedDealId = associatedDealRaw || null;
    const docNotes = String(formData.get("notes") ?? "").trim() || null;

    const blob = await put(`customers/${id}/${Date.now()}-${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    });

    const [prior] = await db
      .select({ id: customerDocuments.id, version: customerDocuments.version, parentDocumentId: customerDocuments.parentDocumentId })
      .from(customerDocuments)
      .where(and(
        eq(customerDocuments.customerId, id),
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

    const [inserted] = await db
      .insert(customerDocuments)
      .values({
        customerId: id,
        category,
        fileName: file.name,
        blobUrl: blob.url,
        mimeType: file.type || null,
        sizeBytes: file.size || null,
        uploadedBy: s.user.id,
        associatedDealId,
        notes: docNotes,
        version,
        isCurrentVersion: true,
        parentDocumentId,
      })
      .returning({ id: customerDocuments.id });

    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await db.insert(documentAuditLog).values({
      documentId: inserted?.id ?? null,
      customerId: id,
      userId: s.user.id,
      action: prior ? "upload_new_version" : "upload",
      ipAddress: ip,
    });
    revalidatePath(`/crm/${id}`);
  }

  async function deleteCustomerDoc(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const docId = String(formData.get("docId") ?? "");
    if (!docId) return;
    // RBAC: load the doc's category and re-check.
    const [doc] = await db.select({ category: customerDocuments.category }).from(customerDocuments).where(eq(customerDocuments.id, docId));
    if (!doc) return;
    const sRole = (s.user as { role?: string }).role;
    if (!categoryVisibleTo(doc.category, sRole)) return;
    await db.delete(customerDocuments).where(eq(customerDocuments.id, docId));
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await db.insert(documentAuditLog).values({
      documentId: docId,
      customerId: id,
      userId: s.user.id,
      action: "delete",
      ipAddress: ip,
    });
    revalidatePath(`/crm/${id}`);
  }

  return (
    <AppShell title={c.name} subtitle={`${c.type} customer`}>
      <div className="flex flex-wrap gap-2">
        <form action={generateQuote}>
          <button
            type="submit"
            className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold"
          >
            + Generate quote
          </button>
        </form>
      </div>

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
        <div className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-2 gap-3 text-center">
          <Stat label="Total deals" value={totalDeals} />
          <Stat label="Active deals" value={activeDeals} />
          <div className="col-span-2">
            <div className="text-2xl font-display font-bold text-white">{fmtMoney(closedWonRevenue)}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mt-1">Revenue (closed-won)</div>
          </div>
          <div className="col-span-2 border-t border-white/5 pt-3">
            <div className="text-sm font-body font-semibold text-white">
              {lastContact ? lastContact.toLocaleDateString() : "—"}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mt-1">Last contact</div>
          </div>
        </div>
      </div>

      {hasExpiringCreds && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-4 space-y-2">
          <h3 className="text-xs font-body font-semibold text-amber-200 uppercase tracking-wider">Expiring credentials</h3>
          {expiringCreds.expired.length > 0 && (
            <ExpirationGroup
              label={`Already expired (${expiringCreds.expired.length})`}
              tone="error"
              creds={expiringCreds.expired}
              dealLabelMap={dealLabelMap}
            />
          )}
          {expiringCreds.in30.length > 0 && (
            <ExpirationGroup
              label={`Within 30 days (${expiringCreds.in30.length})`}
              tone="error"
              creds={expiringCreds.in30}
              dealLabelMap={dealLabelMap}
            />
          )}
          {expiringCreds.in60.length > 0 && (
            <ExpirationGroup
              label={`30 – 60 days (${expiringCreds.in60.length})`}
              tone="warning"
              creds={expiringCreds.in60}
              dealLabelMap={dealLabelMap}
            />
          )}
          {expiringCreds.in90.length > 0 && (
            <ExpirationGroup
              label={`60 – 90 days (${expiringCreds.in90.length})`}
              tone="warning"
              creds={expiringCreds.in90}
              dealLabelMap={dealLabelMap}
            />
          )}
        </div>
      )}

      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Customer folder</h3>
          <span className="text-[10px] font-body text-zinc-500">
            {docRows.length} of {CUSTOMER_DOC_CATEGORIES.length} categories · current versions only
          </span>
        </div>

        <form action={uploadCustomerDoc} encType="multipart/form-data" className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end bg-black/30 border border-white/5 rounded-md p-3">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body md:col-span-1">
            File
            <input type="file" name="file" required className="mt-1 w-full text-[11px] font-body text-zinc-300 file:bg-black/40 file:border file:border-white/10 file:rounded file:px-2 file:py-1 file:text-zinc-300 file:mr-2" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            Category
            <select name="category" defaultValue="misc" className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white">
              {CUSTOMER_DOC_CATEGORIES
                .filter((cat) => allowedCategories.includes(cat.value))
                .map((cat) => (<option key={cat.value} value={cat.value}>{cat.label}</option>))}
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            Associated deal
            <select name="associatedDealId" defaultValue="" className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white">
              <option value="">— None —</option>
              {dealRows.map((d) => (<option key={d.id} value={d.id}>{dealLabelMap.get(d.id)}</option>))}
            </select>
          </label>
          <div className="flex gap-2">
            <input name="notes" placeholder="Notes (optional)" className="flex-1 bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white placeholder:text-zinc-500" />
            <button type="submit" className="text-[11px] font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded px-3 py-1.5">Upload</button>
          </div>
        </form>

        <form className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body md:col-span-2">
            Search filename
            <input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. PO 2024-…" className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white placeholder:text-zinc-500" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            Category
            <select name="category" defaultValue={sp.category ?? ""} className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white">
              <option value="">All</option>
              {CUSTOMER_DOC_CATEGORIES
                .filter((cat) => allowedCategories.includes(cat.value))
                .map((cat) => (<option key={cat.value} value={cat.value}>{cat.label}</option>))}
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            From
            <input name="from" type="date" defaultValue={sp.from ?? ""} className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
            To
            <input name="to" type="date" defaultValue={sp.to ?? ""} className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white" />
          </label>
          <div className="md:col-span-5 flex gap-2 justify-end">
            <a href={`/crm/${id}`} className="text-[11px] text-zinc-400 hover:text-white font-body">Clear</a>
            <button type="submit" className="text-[11px] font-body text-amber-400 hover:text-amber-300">Filter</button>
          </div>
        </form>

        <div className="space-y-3">
          {CUSTOMER_DOC_CATEGORIES.map((cat) => {
            const docs = docsByCategory.get(cat.value) ?? [];
            if (sp.category && sp.category !== cat.value) return null;
            return (
              <details key={cat.value} open={docs.length > 0} className="bg-black/30 border border-white/5 rounded-md">
                <summary className="cursor-pointer px-3 py-2 text-xs font-body font-semibold text-white flex items-center justify-between">
                  <span>{cat.label}</span>
                  <span className="text-[10px] font-normal text-zinc-500">{docs.length} {docs.length === 1 ? "file" : "files"}</span>
                </summary>
                {docs.length > 0 && (
                  <ul className="px-3 pb-3 space-y-1">
                    {docs.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 text-[11px] font-body py-1 border-t border-white/5">
                        <div className="flex-1 min-w-0">
                          <a href={`/api/customer-documents/${d.id}/download`} target="_blank" className="text-zinc-200 hover:text-white truncate inline-block max-w-full">{d.fileName}</a>
                          {d.version > 1 && (<span className="ml-2 text-[10px] text-amber-400">v{d.version}</span>)}
                          {d.notes && (<div className="text-[10px] text-zinc-500 italic">{d.notes}</div>)}
                        </div>
                        <div className="text-[10px] text-zinc-500 whitespace-nowrap flex items-center gap-3">
                          {d.associatedDealId && (
                            <a href={`/deals/${d.associatedDealId}`} className="text-blue-400 hover:text-blue-300">
                              {dealLabelMap.get(d.associatedDealId) ?? "deal"}
                            </a>
                          )}
                          <span>{new Date(d.uploadedAt).toLocaleDateString()}</span>
                          <form action={deleteCustomerDoc} className="inline">
                            <input type="hidden" name="docId" value={d.id} />
                            <button type="submit" className="hover:text-red-400">Delete</button>
                          </form>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
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

function ExpirationGroup({
  label,
  tone,
  creds,
  dealLabelMap,
}: {
  label: string;
  tone: "warning" | "error";
  creds: { id: string; dealId: string; credentialType: string; credentialNumber: string | null; expiresAt: Date | null; daysLeft: number }[];
  dealLabelMap: Map<string, string>;
}) {
  const cls = tone === "error"
    ? "text-red-300"
    : "text-amber-300";
  return (
    <div className="space-y-1">
      <div className={`text-[10px] uppercase tracking-wider font-body font-semibold ${cls}`}>{label}</div>
      <ul className="space-y-1">
        {creds.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-[11px] font-body">
            <a href={`/deals/${c.dealId}`} className="text-zinc-200 hover:text-white">
              {c.credentialType === "LE" ? "LE" : "Generic"}{c.credentialNumber ? ` #${c.credentialNumber}` : ""}
              <span className="text-zinc-500"> · {dealLabelMap.get(c.dealId) ?? c.dealId.slice(0, 8)}</span>
            </a>
            <span className={`text-[10px] ${cls}`}>
              {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
              {" · "}
              {c.daysLeft < 0 ? `${Math.abs(c.daysLeft)}d ago` : `${c.daysLeft}d left`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
