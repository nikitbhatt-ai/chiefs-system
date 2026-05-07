import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";

async function createCustomer(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const type = String(formData.get("type") ?? "commercial") as
    | "government"
    | "commercial"
    | "retail";
  await db.insert(customers).values({
    name,
    type,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    taxExempt: formData.get("taxExempt") === "on",
  });
  revalidatePath("/crm");
}

async function deleteCustomer(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(customers).where(eq(customers.id, id));
  revalidatePath("/crm");
}

export default async function CrmPage() {
  const rows = await db
    .select()
    .from(customers)
    .orderBy(desc(customers.createdAt));

  return (
    <AppShell title="Customers" subtitle="CRM directory">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          Add customer
        </h3>
        <form action={createCustomer} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            name="name"
            required
            placeholder="Name *"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <select
            name="type"
            defaultValue="commercial"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="commercial">Commercial</option>
            <option value="government">Government</option>
            <option value="retail">Retail</option>
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
            name="address"
            placeholder="Address"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-2"
          />
          <label className="flex items-center gap-2 text-xs text-zinc-300 font-body">
            <input type="checkbox" name="taxExempt" />
            Tax exempt
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-amber-500 hover:bg-amber-400 text-black rounded-md px-4 py-2 transition-colors"
            >
              Save customer
            </button>
          </div>
        </form>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Tax</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-xs text-zinc-500"
                >
                  No customers yet — add your first one above.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">{c.name}</td>
                  <td className="px-4 py-2.5 capitalize text-xs">{c.type}</td>
                  <td className="px-4 py-2.5 text-xs">{c.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {c.taxExempt ? "Exempt" : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={deleteCustomer}>
                      <input type="hidden" name="id" value={c.id} />
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
