import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) notFound();

  async function update(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await db
      .update(customers)
      .set({
        name,
        type: String(formData.get("type") ?? "commercial") as
          | "government"
          | "commercial"
          | "retail",
        email: String(formData.get("email") ?? "").trim() || null,
        phone: String(formData.get("phone") ?? "").trim() || null,
        address: String(formData.get("address") ?? "").trim() || null,
        taxExempt: formData.get("taxExempt") === "on",
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id));
    revalidatePath("/crm");
    redirect("/crm");
  }

  return (
    <AppShell title="Edit customer" subtitle={c.name}>
      <form
        action={update}
        className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl"
      >
        <input
          name="name"
          required
          defaultValue={c.name}
          placeholder="Name *"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <select
          name="type"
          defaultValue={c.type}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="commercial">Commercial</option>
          <option value="government">Government</option>
          <option value="retail">Retail</option>
        </select>
        <input
          name="email"
          type="email"
          defaultValue={c.email ?? ""}
          placeholder="Email"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="phone"
          defaultValue={c.phone ?? ""}
          placeholder="Phone"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="address"
          defaultValue={c.address ?? ""}
          placeholder="Address"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
        />
        <label className="flex items-center gap-2 text-xs text-zinc-300 font-body">
          <input type="checkbox" name="taxExempt" defaultChecked={c.taxExempt} />
          Tax exempt
        </label>
        <div className="md:col-span-2 flex justify-end gap-2">
          <a
            href="/crm"
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
