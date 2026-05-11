import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
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

  const transition = canAdvanceTo(d.pipeline, d.stage, requested);
  if (!transition.ok) {
    throw new Error(transition.reason);
  }

  await db
    .update(deals)
    .set({ stage: requested as DealStage, updatedAt: new Date() })
    .where(eq(deals.id, id));
  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
}

export default async function DealsPage() {
  const [customerRows, userRows, dealRows] = await Promise.all([
    db.select({ id: customers.id, name: customers.name, type: customers.type }).from(customers).orderBy(customers.name),
    db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.active, true)),
    db.select().from(deals).orderBy(desc(deals.createdAt)),
  ]);
  const customerMap = new Map(customerRows.map((c) => [c.id, c.name]));
  const userMap = new Map(userRows.map((u) => [u.id, u.name ?? u.email]));

  return (
    <AppShell title="Deals" subtitle="Sales opportunities">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
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
      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">Customer</th>
              <th className="px-3 py-2.5">Pipeline</th>
              <th className="px-3 py-2.5">Vehicle</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Assigned</th>
              <th className="px-3 py-2.5">Referral</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {dealRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">No deals yet — create your first one above.</td></tr>
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
                    <td className="px-3 py-2 text-right whitespace-nowrap">
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
      </div>
      <p className="text-[11px] font-body text-zinc-500">
        Stage transitions are validated against the deal&apos;s pipeline. Stages must be advanced one step at a time; <span className="text-red-300">Lost</span> can be reached from any stage. Backwards movement is allowed.
      </p>
    </AppShell>
  );
}
