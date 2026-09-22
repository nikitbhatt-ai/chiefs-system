"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { requireCapability, PermissionError } from "@/lib/rbac";
import { LOT_STATUSES } from "@/lib/lot";

const schema = z.object({
  vehicleId: z.string().uuid(),
  lotStatus: z.enum(LOT_STATUSES),
});

export type SetLotStatusResult = { ok: true } | { ok: false; error: string };

// Inline lot-status change from the lot view. Moving a vehicle between
// available / assigned / in shop / departed is physical reality, so the
// inventory associate owns it — but the check is made here, from the session,
// not by whether the UI drew a dropdown.
export async function setLotStatusAction(
  vehicleId: string,
  lotStatus: string,
): Promise<SetLotStatusResult> {
  try {
    await requireCapability("vehicle:setLotStatus");
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, error: e.message };
    throw e;
  }

  const parsed = schema.safeParse({ vehicleId, lotStatus });
  if (!parsed.success) {
    return { ok: false, error: "That is not a lot status we recognise." };
  }

  // Note what this deliberately does NOT do: stamping departure. Setting the
  // status to `departed` here changes where we think the vehicle is, but the
  // departure flow (Phase 10) is what closes the open check-in and stops the
  // days-on-lot clock. Keeping that in one place is the point.
  await db
    .update(vehicles)
    .set({ lotStatus: parsed.data.lotStatus, updatedAt: new Date() })
    .where(eq(vehicles.id, parsed.data.vehicleId));

  revalidatePath("/lot");
  revalidatePath("/vehicles");
  return { ok: true };
}
