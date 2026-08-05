import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { VehiclePhotos } from "@/components/VehiclePhotos";
import { publishVehicleAction } from "@/lib/publishVehicle";

const LOTS = ["on-site", "dealership", "upfitting", "sames-dropoff"];
const LOT_LABELS: Record<string, string> = {
  "on-site": "On-site",
  dealership: "Dealership",
  upfitting: "Upfitting",
  "sames-dropoff": "Sames drop-off",
};

const ALLOWED_PUBLISH_ROLES = ["admin", "manager"] as const;

function shopifyAdminUrl(productId: string): string | null {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) return null;
  const host = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/admin/products/${productId}`;
}

export default async function EditVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    published?: string;
    publishId?: string;
    publishError?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!v) notFound();

  const session = await auth();
  const canPublish =
    !!session?.user &&
    ALLOWED_PUBLISH_ROLES.includes(
      session.user.role as (typeof ALLOWED_PUBLISH_ROLES)[number]
    );

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
        description:
          String(formData.get("description") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(vehicles.id, id));
    revalidatePath("/vehicles");
    redirect("/vehicles");
  }

  const blocker = !v.vin
    ? "Add a VIN before publishing."
    : !v.listPrice
      ? "Set a list price before publishing."
      : !v.photos || v.photos.length === 0
        ? "Upload at least one photo before publishing."
        : null;

  const adminUrl = v.shopifyProductId
    ? shopifyAdminUrl(v.shopifyProductId)
    : null;

  return (
    <AppShell
      title="Edit vehicle"
      subtitle={[v.year, v.make, v.model].filter(Boolean).join(" ") || v.vin || v.id}
    >
      <div className="space-y-4 max-w-4xl">
      {sp.publishError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
          Publish failed: {sp.publishError}
        </div>
      ) : null}
      {sp.published === "1" ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm text-green-300">
          Published to Shopify
          {v.shopifyStatus ? ` (${v.shopifyStatus})` : ""}.
        </div>
      ) : null}

      <VehiclePhotos vehicleId={v.id} photos={v.photos ?? []} />
      <form
        action={update}
        className="bg-surface border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
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
        <label className="md:col-span-1">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            Shopify list price (USD)
          </span>
          <input
            name="listPrice"
            defaultValue={v.listPrice ?? ""}
            placeholder="0.00"
            type="number"
            step="0.01"
            min="0"
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </label>
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
        <label className="md:col-span-3">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            Shopify description (sent to the storefront on publish)
          </span>
          <textarea
            name="description"
            defaultValue={v.description ?? ""}
            placeholder="Public-facing description shown on the Shopify product page."
            rows={4}
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </label>
        <label className="md:col-span-3">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            Internal notes (not sent to Shopify)
          </span>
          <textarea
            name="notes"
            defaultValue={v.notes ?? ""}
            placeholder="Lot-side notes — keys, paperwork, recon status, etc."
            rows={3}
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </label>
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

      <div className="bg-surface border border-white/5 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
            Publish to Shopify
          </h3>
          {v.shopifyProductId ? (
            <span
              className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded border px-2 py-0.5 ${
                v.shopifyStatus === "active"
                  ? "bg-green-500/10 text-green-300 border-green-500/30"
                  : "bg-zinc-500/10 text-zinc-300 border-zinc-500/30"
              }`}
            >
              {v.shopifyStatus ?? "live"}
            </span>
          ) : null}
        </div>

        {v.shopifyProductId ? (
          <div className="text-xs text-zinc-300 space-y-1">
            <div>
              Already published. Product ID:{" "}
              <code className="text-zinc-100">{v.shopifyProductId}</code>
            </div>
            {adminUrl ? (
              <a
                href={adminUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline"
              >
                Open in Shopify admin →
              </a>
            ) : null}
          </div>
        ) : !canPublish ? (
          <p className="text-xs text-zinc-500">
            Only admin or manager can publish to Shopify.
          </p>
        ) : blocker ? (
          <p className="text-xs text-zinc-500">
            Save your changes first, then come back to publish.
            <br />
            <span className="text-zinc-400">{blocker}</span>
          </p>
        ) : (
          <form action={publishVehicleAction} className="flex items-center gap-2 flex-wrap">
            <input type="hidden" name="id" value={v.id} />
            <input
              type="hidden"
              name="returnTo"
              value={`/vehicles/${v.id}/edit`}
            />
            <label className="text-[11px] text-zinc-400 flex items-center gap-2">
              Status
              <select
                name="status"
                defaultValue="draft"
                className="bg-black/40 border border-white/10 rounded text-[11px] text-white px-2 py-1"
              >
                <option value="draft">Draft (not public)</option>
                <option value="active">Active (live on storefront)</option>
              </select>
            </label>
            <button
              type="submit"
              className="text-xs font-body font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-md px-4 py-2 transition-colors"
            >
              Publish to Shopify
            </button>
            <span className="text-[11px] text-zinc-500">
              Save form changes above first if you've edited anything.
            </span>
          </form>
        )}
      </div>
      </div>
    </AppShell>
  );
}
