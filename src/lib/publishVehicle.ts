"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { createCarListing } from "../../vinToShopify/index.js";

const ALLOWED_PUBLISH_ROLES = ["admin", "manager"] as const;

export async function publishVehicleAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = (String(formData.get("status") ?? "draft") === "active"
    ? "active"
    : "draft") as "draft" | "active";
  // Where to send the user after the action runs. Defaults to the vehicles
  // list; the edit page passes its own path so the result banner shows up
  // in context.
  const returnTo = String(formData.get("returnTo") ?? "/vehicles");
  if (!id) return;

  const sep = returnTo.includes("?") ? "&" : "?";
  const fail = (msg: string): never => {
    redirect(
      `${returnTo}${sep}publishId=${id}&publishError=${encodeURIComponent(msg)}`
    );
  };

  const session = await auth();
  if (!session?.user) fail("Unauthorized.");
  if (
    !ALLOWED_PUBLISH_ROLES.includes(
      session!.user.role as (typeof ALLOWED_PUBLISH_ROLES)[number]
    )
  ) {
    fail("Only admin or manager can publish to Shopify.");
  }

  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!v) fail("Vehicle not found.");
  if (v!.shopifyProductId) fail("Vehicle is already published.");
  if (!v!.vin) fail("VIN is required to publish.");
  if (!v!.listPrice) fail("List price is required to publish.");
  const photos = v!.photos ?? [];
  if (photos.length === 0) fail("At least one photo is required to publish.");

  // Prefer the public-facing description over internal notes when sending
  // to Shopify. If a vehicle has both, the description wins; if only notes
  // exist, fall back to them so older rows still publish reasonably.
  const shopifyNotes = v!.description?.trim() || v!.notes?.trim() || undefined;

  const result = await createCarListing({
    vin: v!.vin!,
    price: v!.listPrice!,
    condition: v!.condition ?? undefined,
    mileage: v!.mileage ?? undefined,
    photoUrls: photos,
    notes: shopifyNotes,
    status,
  });

  if (result.status === "error") {
    fail(`Shopify (${result.stage}): ${result.error}`);
  }

  await db
    .update(vehicles)
    .set({
      shopifyProductId: String(
        (result as { productId: string | number }).productId
      ),
      shopifyStatus: status,
      shopifyPublishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(vehicles.id, id));

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${id}/edit`);
  redirect(`${returnTo}${sep}publishId=${id}&published=1`);
}
