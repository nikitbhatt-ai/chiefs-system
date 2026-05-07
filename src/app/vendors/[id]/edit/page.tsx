import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

export default async function EditVendorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [v] = await db.select().from(vendors).where(eq(vendors.id, id));
  if (!v) notFound();

  async function update(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const discountRaw = String(formData.get("discountPct") ?? "").trim();
    await db
      .update(vendors)
      .set({
        name,
        contactName: String(formData.get("contactName") ?? "").trim() || null,
        email: String(formData.get("email") ?? "").trim() || null,
        phone: String(formData.get("phone") ?? "").trim() || null,
        address: String(formData.get("address") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        discountPct: discountRaw || null,
        updatedAt: new Date(),
      })
      .where(eq(vendors.id, id));
    revalidatePath("/vendors");
    redirect("/vendors");
  }

  return (
    <AppShell title="Edit vendor" subtitle={v.name}>
      <form
        action={update}
        className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl"
      >
        <input
          name="name"
          required
          defaultValue={v.name}
          placeholder="Vendor name *"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="contactName"
          defaultValue={v.contactName ?? ""}
          placeholder="Contact name"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="email"
          type="email"
          defaultValue={v.email ?? ""}
          placeholder="Email"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="phone"
          defaultValue={v.phone ?? ""}
          placeholder="Phone"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="discountPct"
          type="number"
          min="0"
          max="100"
          step="0.01"
          defaultValue={v.discountPct ?? ""}
          placeholder="Distributor discount %"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="address"
          defaultValue={v.address ?? ""}
          placeholder="Address"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <textarea
          name="notes"
          defaultValue={v.notes ?? ""}
          placeholder="Notes"
          rows={3}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
        />
        <div className="md:col-span-2 flex justify-end gap-2">
          <a
            href="/vendors"
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
