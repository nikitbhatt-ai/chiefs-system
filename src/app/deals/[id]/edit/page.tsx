import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { syncDealToWorkflow } from "@/lib/dealTriggers";

const STAGES = ["prospect", "quote_sent", "po_received", "in_production", "delivered", "lost"] as const;
type Stage = (typeof STAGES)[number];

const REFERRAL_OPTIONS = ["Sames", "Website", "Sales person", "Trade show", "Repeat customer"];

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) notFound();

  const [customerRows, userRows] = await Promise.all([
    db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(customers.name),
    db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.active, true)),
  ]);

  async function update(formData: FormData) {
    "use server";
    const stage = String(formData.get("stage") ?? "prospect") as Stage;
    const finalStage = STAGES.includes(stage) ? stage : "prospect";
    const yearRaw = String(formData.get("vehicleYear") ?? "").trim();
    await db
      .update(deals)
      .set({
        customerId: String(formData.get("customerId") ?? "") || null,
        assignedTo: String(formData.get("assignedTo") ?? "") || null,
        salesRep: String(formData.get("salesRep") ?? "").trim() || null,
        vehicleYear: yearRaw ? Number(yearRaw) : null,
        vehicleMake: String(formData.get("vehicleMake") ?? "").trim() || null,
        vehicleModel: String(formData.get("vehicleModel") ?? "").trim() || null,
        vin: String(formData.get("vin") ?? "").trim().toUpperCase() || null,
        stage: finalStage,
        referralSource: String(formData.get("referralSource") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, id));
    if (finalStage !== d.stage) {
      await syncDealToWorkflow(id, finalStage, d.stage);
    }
    revalidatePath("/deals");
    redirect("/deals");
  }

  return (
    <AppShell title="Edit deal" subtitle={d.id.slice(0, 8)}>
      <form action={update} className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3 max-w-5xl">
        <select name="customerId" defaultValue={d.customerId ?? ""} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
          <option value="">— Customer —</option>
          {customerRows.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <select name="assignedTo" defaultValue={d.assignedTo ?? ""} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
          <option value="">— Assigned to —</option>
          {userRows.map((u) => (<option key={u.id} value={u.id}>{u.name ?? u.email}</option>))}
        </select>
        <select name="stage" defaultValue={d.stage} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
          {STAGES.map((s) => (<option key={s} value={s}>{s.replace(/_/g, " ")}</option>))}
        </select>
        <input name="salesRep" defaultValue={d.salesRep ?? ""} placeholder="Sales rep (free text)" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
        <input name="referralSource" list="referral-options" defaultValue={d.referralSource ?? ""} placeholder="Referral source" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
        <datalist id="referral-options">{REFERRAL_OPTIONS.map((r) => (<option key={r} value={r} />))}</datalist>
        <input name="vin" defaultValue={d.vin ?? ""} placeholder="VIN" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono" />
        <input name="vehicleYear" type="number" defaultValue={d.vehicleYear ?? ""} placeholder="Year" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
        <input name="vehicleMake" defaultValue={d.vehicleMake ?? ""} placeholder="Make" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
        <input name="vehicleModel" defaultValue={d.vehicleModel ?? ""} placeholder="Model" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
        <textarea name="notes" defaultValue={d.notes ?? ""} rows={4} placeholder="Internal notes" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-3" />
        <div className="md:col-span-3 flex justify-end gap-2">
          <a href="/deals" className="text-xs font-body text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors">Cancel</a>
          <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors">Save changes</button>
        </div>
      </form>
    </AppShell>
  );
}
