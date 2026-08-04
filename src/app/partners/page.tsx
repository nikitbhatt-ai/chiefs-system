import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { partners } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

async function createPartner(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.insert(partners).values({
    name,
    type: String(formData.get("type") ?? "dealership").trim() || "dealership",
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/partners");
}

async function deletePartner(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(partners).where(eq(partners.id, id));
  revalidatePath("/partners");
}

export default async function PartnersPage() {
  const rows = await db.select().from(partners).orderBy(desc(partners.createdAt));
  return (
    <AppShell title="Partners" subtitle="Dealerships and referral sources">
      <div className="bg-surface border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">Add partner</h3>
        <form action={createPartner} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input name="name" required placeholder="Name *" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <select name="type" defaultValue="dealership" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            <option value="dealership">Dealership</option>
            <option value="agency">Agency / RFP source</option>
            <option value="other">Other</option>
          </select>
          <input name="email" type="email" placeholder="General email" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <input name="phone" placeholder="Phone" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
          <textarea name="notes" rows={2} placeholder="Notes" className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2" />
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2">Save partner</button>
          </div>
        </form>
      </div>
      <div className="bg-surface border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Email</th>
              <th className="px-3 py-2.5">Phone</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">No partners yet. Add Sames as your first partner above.</td></tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-white">{p.name}</td>
                  <td className="px-3 py-2 capitalize text-xs">{p.type}</td>
                  <td className="px-3 py-2 text-xs">{p.email ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{p.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <a href={`/partners/${p.id}`} className="text-[11px] text-blue-400 hover:text-blue-300 mr-3">Open</a>
                    <form action={deletePartner} className="inline">
                      <input type="hidden" name="id" value={p.id} />
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
