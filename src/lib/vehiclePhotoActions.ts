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
  // etc.) we still want the DB row to reflect the removal.
  try {
    await del(url);
  } catch {}

  revalidatePath(`/vehicles/${vehicleId}/edit`);
  revalidatePath("/vehicles");
}
