"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { auth } from "@/auth";
import { db } from "@/db";
import { vehicles } from "@/db/schema";

export async function addVehiclePhoto(vehicleId: string, url: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const [v] = await db
    .select({ photos: vehicles.photos })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId));
  if (!v) throw new Error("Vehicle not found");

  const current = v.photos ?? [];
  if (current.includes(url)) return;

  await db
    .update(vehicles)
    .set({ photos: [...current, url], updatedAt: new Date() })
    .where(eq(vehicles.id, vehicleId));

  revalidatePath(`/vehicles/${vehicleId}/edit`);
  revalidatePath("/vehicles");
}

export async function removeVehiclePhoto(vehicleId: string, url: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const [v] = await db
    .select({ photos: vehicles.photos })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId));
  if (!v) throw new Error("Vehicle not found");

  const current = v.photos ?? [];
  await db
    .update(vehicles)
    .set({
      photos: current.filter((p) => p !== url),
      updatedAt: new Date(),
    })
    .where(eq(vehicles.id, vehicleId));

  // Best-effort delete from Blob storage. If it fails (already gone, ACL,
  // etc.) we still want the DB row to reflect the removal. Auth via OIDC
  // + BLOB_STORE_ID is handled by the library automatically.
  try {
    await del(url);
  } catch {}

  revalidatePath(`/vehicles/${vehicleId}/edit`);
  revalidatePath("/vehicles");
}

export async function reorderVehiclePhotos(
  vehicleId: string,
  newOrder: string[]
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const [v] = await db
    .select({ photos: vehicles.photos })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId));
  if (!v) throw new Error("Vehicle not found");

  const current = v.photos ?? [];
  // Only persist if the new list is a permutation of what's stored — guards
  // against stale client state silently dropping a photo.
  if (
    newOrder.length !== current.length ||
    !newOrder.every((u) => current.includes(u))
  ) {
    throw new Error("Photo reorder rejected: list no longer matches storage.");
  }

  await db
    .update(vehicles)
    .set({ photos: newOrder, updatedAt: new Date() })
    .where(eq(vehicles.id, vehicleId));

  revalidatePath(`/vehicles/${vehicleId}/edit`);
  revalidatePath("/vehicles");
}
