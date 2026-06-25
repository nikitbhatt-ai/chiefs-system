import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { partners, partnerContacts } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function PartnerEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p] = await db.select().from(partners).where(eq(partners.id, id));
  if (!p) notFound();
  const contacts = await db.select().from(partnerContacts).where(eq(partnerContacts.partnerId, id)).orderBy(asc(partnerContacts.name));

  async function update(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    await db.update(partners).set({
      name: String(formData.get("name") ?? "").trim() || p.name,
      type: String(formData.get("type") ?? "dealership"),
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      active: formData.get("active") === "on",
      updatedAt: new Date(),
    }).where(eq(partners.id, id));
    revalidatePath(`/partners/${id}`);
    revalidatePath("/partners");
  }

  async function addContact(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await db.insert(partnerContacts).values({
      partnerId: id,
      name,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      location: String(formData.get("location") ?? "").trim() || null,
      title: String(formData.get("title") ?? "").trim() || null,
    });
    revalidatePath(`/partners/${id}`);
  }

  async function deleteContact(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) return;
    const cid = String(formData.get("cid") ?? "");
    if (!cid) return;
    await db.delete(partnerContacts).where(eq(partnerContacts.id, cid));
    revalidatePath(`/partners/${id}`);
  }

  const inputCls = "bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500";

  return (
    <AppShell title={p.name} subtitle={`${p.type} partner`}>
      <form action={update} className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <input name="name" defaultValue={p.name} className={inputCls} />
        <select name="type" defaultValue={p.type} className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
          <option value="dealership">Dealership</option>
          <option value="agency">Agency / RFP source</option>
          <option value="other">Other</option>
        </select>
        <input name="email" defaultValue={p.email ?? ""} placeholder="General email" className={inputCls} />
        <input name="phone" defaultValue={p.phone ?? ""} placeholder="Phone" className={inputCls} />
        <textarea name="notes" defaultValue={p.notes ?? ""} rows={2} placeholder="Notes" className={`${inputCls} md:col-span-2`} />
        <label className="flex items-center gap-2 text-xs text-zinc-300 font-body"><input type="checkbox" name="active" defaultChecked={p.active} />Active (referrals can be attributed)</label>
        <div className="flex justify-end"><button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Save changes</button></div>
      </form>
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">Add contact</h3>
        <form action={addContact} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input name="name" required placeholder="Name *" className={inputCls} />
          <input name="title" placeholder="Title" className={inputCls} />
          <input name="location" placeholder="Location" className={inputCls} />
          <input name="email" type="email" placeholder="Email" className={inputCls} />
          <input name="phone" placeholder="Phone" className={inputCls} />
          <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Add contact</button>
        </form>
      </div>
      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Location</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {contacts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">No contacts yet.</td></tr>
            ) : (
              contacts.map((c) => (
                <tr key={c.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-white text-xs">{c.name}</td>
                  <td className="px-3 py-2 text-xs">{c.title ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{c.location ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{c.email ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={deleteContact} className="inline">
                      <input type="hidden" name="cid" value={c.id} />
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
