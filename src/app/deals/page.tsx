import { revalidatePath } from "next/cache";
import { and, arrayContains, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users, dealCredentials } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { Pagination } from "@/components/Pagination";
import { ListRowControls } from "@/components/ListRowControls";
import { ListFilters } from "@/components/ListFilters";
import { parsePagination } from "@/lib/pagination";
import { canDelete } from "@/lib/rbac";
import { auth } from "@/auth";
import { isCredentialActive } from "@/lib/credentials";
import { fmtDateTime } from "@/lib/datetime";
import { maybeCreateDocReminder, maybePromoteWonDeal } from "@/lib/dealTriggers";
import {
  PIPELINES,
  PIPELINE_SLUGS,
  STAGE_COLORS,
  canAdvanceTo,
  getPipeline,
  isPipelineSlug,
  pipelineForCustomerType,
  stageLabel,
  type DealStage,
  type PipelineSlug,
} from "@/lib/pipelines";

export const dynamic = "force-dynamic";

const REFERRAL_OPTIONS = ["Sames", "Website", "Sales person", "Trade show", "Repeat customer"];

async function createDeal(formData: FormData) {
  "use server";
  const customerId = String(formData.get("customerId") ?? "") || null;
  const assignedTo = String(formData.get("assignedTo") ?? "") || null;
  const requestedPipeline = String(formData.get("pipeline") ?? "");
  const yearRaw = String(formData.get("vehicleYear") ?? "").trim();

  let pipeline: PipelineSlug;
  if (isPipelineSlug(requestedPipeline)) {
    pipeline = requestedPipeline;
  } else if (customerId) {
    const [c] = await db
      .select({ type: customers.type })
      .from(customers)
      .where(eq(customers.id, customerId));
    pipeline = pipelineForCustomerType(c?.type);
  } else {
    pipeline = "commercial";
  }

  await db.insert(deals).values({
    customerId,
    assignedTo,
    pipeline,
    salesRep: String(formData.get("salesRep") ?? "").trim() || null,
    vehicleYear: yearRaw ? Number(yearRaw) : null,
    vehicleMake: String(formData.get("vehicleMake") ?? "").trim() || null,
    vehicleModel: String(formData.get("vehicleModel") ?? "").trim() || null,
    vin: String(formData.get("vin") ?? "").trim().toUpperCase() || null,
    stage: "prospect",
    referralSource: String(formData.get("referralSource") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/deals");
}

async function deleteDeal(formData: FormData) {
  "use server";
  const session = await auth();
  if (!canDelete(session)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(deals).where(eq(deals.id, id));
  revalidatePath("/deals");
}

async function changeStage(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const requested = String(formData.get("stage") ?? "");
  if (!id) return;

  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) return;

  const creds = await db
    .select({ verifiedAt: dealCredentials.verifiedAt, expiresAt: dealCredentials.expiresAt })
    .from(dealCredentials)
    .where(eq(dealCredentials.dealId, id));
  const hasActiveCredential = creds.some((c) => isCredentialActive(c));

  const transition = canAdvanceTo(d.pipeline, d.stage, requested, { hasActiveCredential });
  if (!transition.ok) {
    throw new Error(transition.reason);
  }

  await db
    .update(deals)
    .set({ stage: requested as DealStage, currentStageEnteredAt: new Date(), updatedAt: new Date() })
    .where(eq(deals.id, id));
  await maybePromoteWonDeal(id, requested, d.stage);
  await maybeCreateDocReminder(id, requested, d.stage);
  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  revalidatePath("/workflow");
  revalidatePath("/quotes");
  revalidatePath("/work-orders");
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; page?: string; view?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const stage = (sp.stage ?? "").trim();
  const view = sp.view === "archived" ? "archived" : "active";
  const tag = (sp.tag ?? "").trim();
  const { page, perPage, offset } = parsePagination(sp.page);

  // Build the WHERE. Free-text search matches vehicle fields + sales rep, plus
  // any customer whose name matches (resolved to ids first to avoid a join).
  const filters = [eq(deals.archived, view === "archived")];
  if (tag) filters.push(arrayContains(deals.tags, [tag]));
  if (stage) filters.push(eq(deals.stage, stage as DealStage));
  if (q) {
    const like = `%${q}%`;
    const matchCustomerIds = (
      await db.select({ id: customers.id }).from(customers).where(ilike(customers.name, like))
    ).map((c) => c.id);
    const ors = [
      ilike(deals.vin, like),
      ilike(deals.vehicleMake, like),
      ilike(deals.vehicleModel, like),
      ilike(deals.salesRep, like),
    ];
    if (matchCustomerIds.length) ors.push(inArray(deals.customerId, matchCustomerIds));
    const orCond = or(...ors);
    if (orCond) filters.push(orCond);
  }
  const where = filters.length ? and(...filters) : undefined;

  const [customerRows, userRows, totalRows, dealRows] = await Promise.all([
    db.select({ id: customers.id, name: customers.name, type: customers.type }).from(customers).orderBy(customers.name),
    db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.active, true)),
    db.select({ n: count() }).from(deals).where(where),
    db.select().from(deals).where(where).orderBy(desc(deals.createdAt)).limit(perPage).offset(offset),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);
  const customerMap = new Map(customerRows.map((c) => [c.id, c.name]));
  const userMap = new Map(userRows.map((u) => [u.id, u.name ?? u.email]));

  const baseQuery = (() => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (stage) qs.set("stage", stage);
    if (view === "archived") qs.set("view", "archived");
    if (tag) qs.set("tag", tag);
    return qs.toString();
  })();

  const ALL_STAGES: DealStage[] = [
    "prospect", "credential_verification", "quote_sent", "po_received",
    "deposit_received", "in_production", "delivered", "lost",
  ];

  return (
    <AppShell title="Deals" subtitle="Sales opportunities">
      <div className="bg-surface border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">New deal</h3>
        <form action={createDeal} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select name="customerId" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">— Customer —</option>
            {customerRows.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <select name="assignedTo" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">— Assigned to —</option>
            {userRows.map((u) => (<option key={u.id} value={u.id}>{u.name ?? u.email}</option>))}
          </select>
          <select name="pipeline" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">— Pipeline (auto from customer if blank) —</option>
            {PIPELINE_SLUGS.map((slug) => (<option key={slug} value={slug}>{PIPELINES[slug].label}</option>))}
          </select>
          <input name="salesRep" placeholder="Sales rep (free text fallback)" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="referralSource" list="referral-options" placeholder="Referral source" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <datalist id="referral-options">{REFERRAL_OPTIONS.map((r) => (<option key={r} value={r} />))}</datalist>
          <input name="vin" placeholder="VIN (optional)" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono" />
          <input name="vehicleYear" type="number" placeholder="Year" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="vehicleMake" placeholder="Make" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="vehicleModel" placeholder="Model" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <textarea name="notes" rows={2} placeholder="Internal notes" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-3" />
          <div className="md:col-span-3 flex justify-end"><button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">Save deal</button></div>
        </form>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form method="get" className="flex flex-wrap items-center gap-2">
          {view === "archived" && <input type="hidden" name="view" value="archived" />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search customer, VIN, make, model, rep…"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 flex-1 min-w-[220px]"
          />
          <select name="stage" defaultValue={stage} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">All stages</option>
            {ALL_STAGES.map((s) => (<option key={s} value={s}>{stageLabel(s)}</option>))}
          </select>
          <button type="submit" className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white rounded-md px-4 py-2">Filter</button>
          {(q || stage) && (
            <a href="/deals" className="text-[11px] text-zinc-400 hover:text-zinc-200">Clear</a>
          )}
        </form>
        <ListFilters basePath="/deals" view={view} tag={tag} carry={{ q, stage }} />
      </div>
      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">Customer</th>
              <th className="px-3 py-2.5">Pipeline</th>
              <th className="px-3 py-2.5">Vehicle</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Assigned</th>
              <th className="px-3 py-2.5">Referral</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {dealRows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">No deals yet — create your first one above.</td></tr>
            ) : (
              dealRows.map((d) => {
                const pipeline = getPipeline(d.pipeline);
                const validStages = pipeline.stages;
                const stageInPipeline = validStages.includes(d.stage as DealStage);
                return (
                  <tr key={d.id} className="border-t border-white/5">
                    <td className="px-3 py-2 text-xs text-white">{d.customerId ? customerMap.get(d.customerId) ?? "—" : "—"}</td>
                    <td className="px-3 py-2 text-[11px]">
                      <span className="inline-block rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-zinc-300">{pipeline.label}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{[d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-3 py-2">
                      <form action={changeStage} className="inline-flex items-center gap-1">
                        <input type="hidden" name="id" value={d.id} />
                        <select name="stage" defaultValue={d.stage} className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 bg-black/40 ${STAGE_COLORS[d.stage]}`}>
                          {!stageInPipeline && (<option value={d.stage}>{stageLabel(d.stage)} (off-pipeline)</option>)}
                          {validStages.map((s) => (<option key={s} value={s}>{stageLabel(s)}</option>))}
                          {!validStages.includes("lost") && (<option value="lost">Lost</option>)}
                        </select>
                        <button type="submit" className="text-[10px] text-amber-400 hover:text-amber-300">Save</button>
                      </form>
                    </td>
                    <td className="px-3 py-2 text-xs">{d.assignedTo ? userMap.get(d.assignedTo) ?? "—" : (d.salesRep ?? "—")}</td>
                    <td className="px-3 py-2 text-xs">{d.referralSource ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(d.createdAt)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2 mb-1"><ListRowControls entity="deals" id={d.id} tags={d.tags ?? []} archived={d.archived} /></div>
                      <a href={`/deals/${d.id}`} className="text-[11px] text-blue-400 hover:text-blue-300 mr-3">Open</a>
                      <a href={`/deals/${d.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300 mr-3">Edit</a>
                      <form action={deleteDeal} className="inline"><input type="hidden" name="id" value={d.id} /><button type="submit" className="text-[11px] text-zinc-500 hover:text-red-400">Delete</button></form>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <Pagination page={page} total={total} perPage={perPage} baseQuery={baseQuery} />
      </div>
      <p className="text-[11px] font-body text-zinc-500">
        Stage transitions are validated against the deal&apos;s pipeline. Stages must be advanced one step at a time; <span className="text-red-300">Lost</span> can be reached from any stage. Backwards movement is allowed.
      </p>
    </AppShell>
  );
}
