import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

const STAGES = ["prospect", "quote_sent", "po_received", "in_production", "delivered", "lost"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  quote_sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  po_received: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_production: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  delivered: "bg-green-500/10 text-green-300 border-green-500/30",
  lost: "bg-red-500/10 text-red-300 border-red-500/30",
};

const REFERRAL_OPTIONS = ["Sames", "Website", "Sales person", "Trade show", "Repeat customer"];

async function createDeal(formData: FormData) {
  "use server";
  const customerId = String(formData.get("customerId") ?? "") || null;
  const assignedTo = String(formData.get("assignedTo") ?? "") || null;
  const stage = String(formData.get("stage") ?? "prospect") as Stage;
  const yearRaw = String(formData.get("vehicleYear") ?? "").trim();
  await db.insert(deals).values({
    customerId,
    assignedTo,
    salesRep: String(formData.get("salesRep") ?? "").trim() || null,
    vehicleYear: yearRaw ? Number(yearRaw) : null,
    vehicleMake: String(formData.get("vehicleMake") ?? "").trim() || null,
    vehicleModel: String(formData.get("vehicleModel") ?? "").trim() || null,
    vin: String(formData.get("vin") ?? "").trim().toUpperCase() || null,
    stage: STAGES.includes(stage) ? stage : "prospect",
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
  const stage = String(formData.get("stage") ?? "") as Stage;
  if (!id || !STAGES.includes(stage)) return;
  await db
    .update(deals)
    .set({ stage, updatedAt: new Date() })
    .where(eq(deals.id, id));
  revalidatePath("/deals");
}

export default async function DealsPage() {
  const [customerRows, userRows, dealRows] = await Promise.all([
    db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(customers.name),
    db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.active, true)),
    db.select().from(deals).orderBy(desc(deals.createdAt)),
  ]);

  const customerMap = new Map(customerRows.map((c) => [c.id, c.name]));
  const userMap = new Map(userRows.map((u) => [u.id, u.name ?? u.email]));

  return (
    <AppShell title="Deals" subtitle="Sales opportunities">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          New deal
        </h3>
        <form action={createDeal} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select name="customerId" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">— Customer —</option>
            {customerRows.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <select name="assignedTo" defaultValue="" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="">— Assigned to —</option>
            {userRows.map((u) => (<option key={u.id} value={u.id}>{u.name ?? u.email}</option>))}
          </select>
          <select name="stage" defaultValue="prospect" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            {STAGES.map((s) => (<option key={s} value={s}>{s.replace(/_/g, " ")}</option>))}
          </select>
          <input name="salesRep" placeholder="Sales rep (free text fallback)" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="referralSource" list="referral-options" placeholder="Referral source" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <datalist id="referral-options">{REFERRAL_OPTIONS.map((r) => (<option key={r} value={r} />))}</datalist>
          <input name="vin" placeholder="VIN (optional)" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono" />
          <input name="vehicleYear" type="number" placeholder="Year" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="vehicleMake" placeholder="Make" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="vehicleModel" placeholder="Model" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <textarea name="notes" rows={2} placeholder="Internal notes" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-3" />
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">Save deal</button>
          </div>
        </form>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">Customer</th>
              <th className="px-3 py-2.5">Vehicle</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Assigned</th>
              <th className="px-3 py-2.5">Referral</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {dealRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">No deals yet — create your first one above.</td></tr>
            ) : (
              dealRows.map((d) => (
                <tr key={d.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-xs text-white">{d.customerId ? customerMap.get(d.customerId) ?? "—" : "—"}</td>
                  <td className="px-3 py-2 text-xs">{[d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-3 py-2">
                    <form action={changeStage} className="inline-flex items-center gap-1">
                      <input type="hidden" name="id" value={d.id} />
                      <select name="stage" defaultValue={d.stage} className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 bg-black/40 ${STAGE_COLORS[d.stage]}`}>
                        {STAGES.map((s) => (<option key={s} value={s}>{s.replace(/_/g, " ")}</option>))}
                      </select>
                      <button type="submit" className="text-[10px] text-amber-400 hover:text-amber-300">Save</button>
                    </form>
                  </td>
                  <td className="px-3 py-2 text-xs">{d.assignedTo ? userMap.get(d.assignedTo) ?? "—" : (d.salesRep ?? "—")}</td>
                  <td className="px-3 py-2 text-xs">{d.referralSource ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <a href={`/deals/${d.id}/edit`} className="text-[11px] text-amber-400 hover:text-amber-300 mr-3">Edit</a>
                    <form action={deleteDeal} className="inline">
                      <input type="hidden" name="id" value={d.id} />
                      <button type="submit" className="text-[11px] text-zinc-500 hover:text-red-400">Delete</button>
                    </form>
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
