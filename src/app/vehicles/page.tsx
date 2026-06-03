import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { fmtDateTime } from "@/lib/datetime";
import { auth } from "@/auth";
import { publishVehicleAction } from "@/lib/publishVehicle";
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
  const listPriceRaw = String(formData.get("listPrice") ?? "").trim();
  try {
    await db.insert(vehicles).values({
      vin: vin || null,
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
    });
  } catch (err: unknown) {
    const e = err as {
      code?: string;
      constraint_name?: string;
      message?: string;
    };
    let msg = e.message ?? "Could not save vehicle.";
    if (e.code === "23505" && e.constraint_name === "vehicles_vin_unique") {
      msg = `A vehicle with VIN ${vin} already exists — edit that row instead of adding a new one.`;
    }
    redirect(`/vehicles?addError=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/vehicles");
}

const ALLOWED_PUBLISH_ROLES = ["admin", "manager"] as const;

async function deleteVehicle(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(vehicles).where(eq(vehicles.id, id));
  revalidatePath("/vehicles");
}

function shopifyAdminUrl(productId: string): string | null {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) return null;
  const host = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/admin/products/${productId}`;
}

function publishBlocker(v: typeof vehicles.$inferSelect): string | null {
  if (!v.vin) return "Add a VIN to publish.";
  if (!v.listPrice) return "Set a list price to publish.";
  if (!v.photos || v.photos.length === 0) {
    return "Upload at least one photo to publish.";
  }
  return null;
}

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{
    published?: string;
    publishId?: string;
    publishError?: string;
    addError?: string;
  }>;
}) {
  const session = await auth();
  const canPublish =
    !!session?.user &&
    ALLOWED_PUBLISH_ROLES.includes(
      session.user.role as (typeof ALLOWED_PUBLISH_ROLES)[number]
    );

  const sp = await searchParams;
  const rows = await db.select().from(vehicles).orderBy(desc(vehicles.createdAt));
  const justPublished =
    sp.published === "1" && sp.publishId
      ? rows.find((r) => r.id === sp.publishId)
      : null;

  return (
    <AppShell title="Vehicles" subtitle="Lot inventory across all locations">
      {sp.addError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
          {sp.addError}
        </div>
      ) : null}
      {sp.publishError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
          Publish failed: {sp.publishError}
        </div>
      ) : null}
      {justPublished ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm text-green-300 flex items-center gap-3">
          <span>
            Published to Shopify
            {justPublished.shopifyStatus
              ? ` (${justPublished.shopifyStatus})`
              : ""}
            .
          </span>
          {justPublished.shopifyProductId
            ? (() => {
                const url = shopifyAdminUrl(justPublished.shopifyProductId);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    Open in Shopify admin →
                  </a>
                ) : null;
              })()
            : null}
        </div>
      ) : null}
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
              <th className="px-4 py-2.5">Shopify</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="font-body text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No vehicles yet — add one above (decode by VIN or enter manually).
                </td>
              </tr>
            ) : (
              rows.map((v) => {
                const blocker = publishBlocker(v);
                const adminUrl = v.shopifyProductId
                  ? shopifyAdminUrl(v.shopifyProductId)
                  : null;
                return (
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
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {v.shopifyProductId ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${
                              v.shopifyStatus === "active"
                                ? "bg-green-500/10 text-green-300 border-green-500/30"
                                : "bg-zinc-500/10 text-zinc-300 border-zinc-500/30"
                            }`}
                          >
                            {v.shopifyStatus ?? "live"}
                          </span>
                          {adminUrl ? (
                            <a
                              href={adminUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-400 hover:text-blue-300"
                            >
                              View →
                            </a>
                          ) : null}
                        </div>
                      ) : !canPublish ? (
                        <span className="text-zinc-600">—</span>
                      ) : blocker ? (
                        <span
                          className="text-[11px] text-zinc-500"
                          title={blocker}
                        >
                          {blocker}
                        </span>
                      ) : (
                        <form action={publishVehicleAction} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="returnTo" value="/vehicles" />
                          <select
                            name="status"
                            defaultValue="draft"
                            className="bg-black/40 border border-white/10 rounded text-[11px] text-white px-1.5 py-0.5"
                          >
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                          </select>
                          <button
                            type="submit"
                            className="text-[11px] font-body font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded px-2 py-0.5"
                          >
                            Publish
                          </button>
                        </form>
                      )}
                    </td>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
