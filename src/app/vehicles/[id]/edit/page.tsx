import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { VehiclePhotos } from "@/components/VehiclePhotos";

const LOTS = ["on-site", "dealership", "upfitting", "sames-dropoff"];
const LOT_LABELS: Record<string, string> = {
  "on-site": "On-site",
  dealership: "Dealership",
  upfitting: "Upfitting",
  "sames-dropoff": "Sames drop-off",
};

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!v) notFound();

  async function update(formData: FormData) {
    "use server";
    const yearRaw = String(formData.get("year") ?? "").trim();
    const mileageRaw = String(formData.get("mileage") ?? "").trim();
    const listPriceRaw = String(formData.get("listPrice") ?? "").trim();
    await db
      .update(vehicles)
      .set({
        vin: String(formData.get("vin") ?? "").trim().toUpperCase() || null,
        year: yearRaw ? Number(yearRaw) : null,
        make: String(formData.get("make") ?? "").trim() || null,
        model: String(formData.get("model") ?? "").trim() || null,
        trim: String(formData.get("trim") ?? "").trim() || null,
        color: String(formData.get("color") ?? "").trim() || null,
        mileage: mileageRaw ? Number(mileageRaw) : null,
        listPrice: listPriceRaw || null,
        condition: String(formData.get("condition") ?? "").trim() || null,
        status: String(formData.get("status") ?? "new") as
          | "new"
          | "received"
          | "ready_for_pickup"
          | "delivered"
          | "sold",
        lotLocation: String(formData.get("lotLocation") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(vehicles.id, id));
    revalidatePath("/vehicles");
    redirect("/vehicles");
  }

  return (
    <AppShell
      title="Edit vehicle"
      subtitle={[v.year, v.make, v.model].filter(Boolean).join(" ") || v.vin || v.id}
    >
      <div className="space-y-4 max-w-4xl">
      <VehiclePhotos vehicleId={v.id} photos={v.photos ?? []} />
      <form
        action={update}
        className="bg-[#161624] border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
      >
        <input
          name="vin"
          defaultValue={v.vin ?? ""}
          placeholder="VIN"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 font-mono md:col-span-3"
        />
        <input
          name="year"
          defaultValue={v.year ?? ""}
          placeholder="Year"
          type="number"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="make"
          defaultValue={v.make ?? ""}
          placeholder="Make"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="model"
          defaultValue={v.model ?? ""}
          placeholder="Model"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="trim"
          defaultValue={v.trim ?? ""}
          placeholder="Trim"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="color"
          defaultValue={v.color ?? ""}
          placeholder="Color"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="mileage"
          defaultValue={v.mileage ?? ""}
          placeholder="Mileage"
          type="number"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <input
          name="listPrice"
          defaultValue={v.listPrice ?? ""}
          placeholder="List price (USD)"
          type="number"
          step="0.01"
          min="0"
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <select
          name="condition"
          defaultValue={v.condition ?? ""}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="">Condition (none)</option>
          <option value="Used - Excellent">Used - Excellent</option>
          <option value="Used - Good">Used - Good</option>
          <option value="Used - Fair">Used - Fair</option>
          <option value="New">New</option>
        </select>
        <select
          name="lotLocation"
          defaultValue={v.lotLocation ?? ""}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
        >
          <option value="">Lot (none)</option>
          {LOTS.map((l) => (
            <option key={l} value={l}>
              {LOT_LABELS[l] ?? l}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={v.status}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white md:col-span-2"
        >
          <option value="new">New</option>
          <option value="received">Received</option>
          <option value="ready_for_pickup">Ready for pickup</option>
          <option value="delivered">Delivered</option>
          <option value="sold">Sold</option>
        </select>
        <textarea
          name="notes"
          defaultValue={v.notes ?? ""}
          placeholder="Notes"
          rows={3}
          className="bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 md:col-span-3"
        />
        <div className="md:col-span-3 flex justify-end gap-2">
          <a
            href="/vehicles"
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
      </div>
    </AppShell>
  );
}
