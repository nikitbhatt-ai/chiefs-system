import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";
import { VehicleAddForm } from "./VehicleAddForm";

const LOTS = ["on-site", "dealership", "upfitting", "sames-dropoff"] as const;
type Lot = (typeof LOTS)[number];

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  received: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  ready_for_pickup: "bg-green-500/10 text-green-300 border-green-500/30",
  delivered: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  sold: "bg-purple-500/10 text-purple-300 border-purple-500/30",
};

const LOT_LABELS: Record<string, string> = {
  "on-site": "On-site",
  dealership: "Dealership",
  upfitting: "Upfitting",
  "sames-dropoff": "Sames drop-off",
};

async function createVehicle(formData: FormData) {
  "use server";
  const vin = String(formData.get("vin") ?? "").trim().toUpperCase();
  const yearRaw = String(formData.get("year") ?? "").trim();
  const mileageRaw = String(formData.get("mileage") ?? "").trim();
  await db.insert(vehicles).values({
    vin: vin || null,
    year: yearRaw ? Number(yearRaw) : null,
    make: String(formData.get("make") ?? "").trim() || null,
    model: String(formData.get("model") ?? "").trim() || null,
    trim: String(formData.get("trim") ?? "").trim() || null,
    color: String(formData.get("color") ?? "").trim() || null,
    mileage: mileageRaw ? Number(mileageRaw) : null,
    status: String(formData.get("status") ?? "new") as
      | "new"
      | "received"
      | "ready_for_pickup"
      | "delivered"
      | "sold",
    lotLocation: String(formData.get("lotLocation") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/vehicles");
}

async function deleteVehicle(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(vehicles).where(eq(vehicles.id, id));
  revalidatePath("/vehicles");
}

export default async function VehiclesPage() {
  const rows = await db.select().from(vehicles).orderBy(desc(vehicles.createdAt));

  return (
    <AppShell title="Vehicles" subtitle="Lot inventory across all locations">
      <VehicleAddForm action={createVehicle} lots={LOTS as unknown as string[]} />

      <div className="bg-[#161624] border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 font-body">
              <th className="px-4 py-2.5">Vehicle</th>
              <th className="px-4 py-2.5">VIN</th>
              <th className="px-4 py-2.5">Lot</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Mileage</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No vehicles yet — add one above (decode by VIN or enter manually).
                </td>
              </tr>
            ) : (
              rows.map((v) => (
                <tr key={v.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white">
                    {[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "—"}
                    {v.color ? (
                      <span className="text-zinc-500 text-xs ml-2">· {v.color}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-zinc-400">
                    {v.vin ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {v.lotLocation ? LOT_LABELS[v.lotLocation] ?? v.lotLocation : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${STATUS_COLORS[v.status]}`}
                    >
                      {v.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {v.mileage != null ? v.mileage.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmtDateTime(v.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <a
                      href={`/vehicles/${v.id}/edit`}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-body mr-3"
                    >
                      Edit
                    </a>
                    <form action={deleteVehicle} className="inline">
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
