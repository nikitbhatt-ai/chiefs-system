import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";

async function createVendor(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const discountRaw = String(formData.get("discountPct") ?? "").trim();
  const discountPct = discountRaw ? discountRaw : null;
  await db.insert(vendors).values({
    name,
    contactName: String(formData.get("contactName") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    discountPct,
  });
  revalidatePath("/vendors");
}

async function deleteVendor(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(vendors).where(eq(vendors.id, id));
  revalidatePath("/vendors");
}

export default async function VendorsPage() {
  const rows = await db.select().from(vendors).orderBy(desc(vendors.createdAt));

  return (
    <AppShell title="Vendors" subtitle="Suppliers & service providers">
      <div className="bg-[#161624] border border-white/5 rounded-lg p-4">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider mb-3">
          Add vendor
        </h3>
        <form action={createVendor} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            name="name"
            required
            placeholder="Vendor name *"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <input
            name="contactName"
            placeholder="Contact name"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
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
            name="discountPct"
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Distributor discount %"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <input
            name="address"
            placeholder="Address"
            className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
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
              Save vendor
            </button>
          </div>
        </form>
      </div>

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Contact</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Discount</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No vendors yet — add your first one above.
                </td>
              </tr>
            ) : (
              rows.map((v) => (
                <tr key={v.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">{v.name}</td>
                  <td className="px-4 py-2.5 text-xs">{v.contactName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{v.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{v.phone ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {v.discountPct != null ? `${v.discountPct}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(v.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={`/vendors/${v.id}/edit`}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3"
                    >
                      Edit
                    </a>
                    <form action={deleteVendor} className="inline">
                      <input type="hidden" name="id" value={v.id} />
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
