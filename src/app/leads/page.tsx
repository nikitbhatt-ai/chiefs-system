import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

async function createLead(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.insert(leads).values({
    name,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    source: String(formData.get("source") ?? "").trim() || null,
    status: String(formData.get("status") ?? "new") as
      | "new"
      | "contacted"
      | "converted"
      | "lost",
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/leads");
}

async function deleteLead(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/leads");
}

async function convertLead(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) return;
  const [customer] = await db
    .insert(customers)
    .values({
      name: lead.name,
      type: "commercial",
      email: lead.email,
      phone: lead.phone,
    })
    .returning();
  await db
    .update(leads)
    .set({
      status: "converted",
      convertedCustomerId: customer.id,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id));
  revalidatePath("/leads");
  revalidatePath("/crm");
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  contacted: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  converted: "bg-green-500/10 text-green-300 border-green-500/30",
  lost: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

export default async function LeadsPage() {
  const rows = await db.select().from(leads).orderBy(desc(leads.createdAt));

  return (
    <AppShell title="Leads" subtitle="Pipeline of prospects before they become customers">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          Add lead
        </h3>
        <form action={createLead} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            name="name"
            required
            placeholder="Lead name *"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <select
            name="status"
            defaultValue="new"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="converted">Converted</option>
            <option value="lost">Lost</option>
          </select>
          <input
            name="email"
            type="email"
            placeholder="Email"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <input
            name="phone"
            placeholder="Phone"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <input
            name="source"
            placeholder="Source (referral, web, trade show...)"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
          />
          <textarea
            name="notes"
            placeholder="Notes"
            rows={2}
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
          />
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
            >
              Save lead
            </button>
          </div>
        </form>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No leads yet — add your first one above.
                </td>
              </tr>
            ) : (
              rows.map((l) => (
                <tr key={l.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">{l.name}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[l.status]}`}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{l.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{l.phone ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{l.source ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {l.status !== "converted" ? (
                      <form action={convertLead} className="inline">
                        <input type="hidden" name="id" value={l.id} />
                        <button
                          type="submit"
                          className="text-[11px] text-green-400 hover:text-green-300 font-body mr-3"
                        >
                          Convert
                        </button>
                      </form>
                    ) : null}
                    <a
                      href={`/leads/${l.id}/edit`}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3"
                    >
                      Edit
                    </a>
                    <form action={deleteLead} className="inline">
                      <input type="hidden" name="id" value={l.id} />
                      <button
                        type="submit"
                        className="text-[11px] text-zinc-500 hover:text-red-400 font-body"
                      >
                        Delete
                      </button>
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
