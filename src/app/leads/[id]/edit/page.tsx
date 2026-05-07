import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

export default async function EditLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [l] = await db.select().from(leads).where(eq(leads.id, id));
  if (!l) notFound();

  async function update(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await db
      .update(leads)
      .set({
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
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id));
    revalidatePath("/leads");
    redirect("/leads");
  }

  return (
    <AppShell title="Edit lead" subtitle={l.name}>
      <form
        action={update}
        className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl"
      >
        <input
          name="name"
          required
          defaultValue={l.name}
          placeholder="Lead name *"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <select
          name="status"
          defaultValue={l.status}
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
          defaultValue={l.email ?? ""}
          placeholder="Email"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="phone"
          defaultValue={l.phone ?? ""}
          placeholder="Phone"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="source"
          defaultValue={l.source ?? ""}
          placeholder="Source"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
        />
        <textarea
          name="notes"
          defaultValue={l.notes ?? ""}
          placeholder="Notes"
          rows={3}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
        />
        <div className="md:col-span-2 flex justify-end gap-2">
          <a
            href="/leads"
            className="text-xs font-body text-zinc-400 hover:text-white border border-white/10 rounded-md px-4 py-2 transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
          >
            Save changes
          </button>
        </div>
      </form>
    </AppShell>
  );
}
