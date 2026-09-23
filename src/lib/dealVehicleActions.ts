"use server";

import { revalidatePath } from "next/cache";
import {
  linkVehicleToDeal,
  unlinkVehicleFromDeal,
  searchDealsForLinking,
  searchVehiclesForLinking,
  type LinkResult,
  type UnlinkResult,
  type DealSearchRow,
  type VehicleSearchRow,
} from "@/lib/dealVehicles";
import { requireCapability } from "@/lib/rbac";

// Thin "use server" wrappers so the two UI entry points — the lot view and the
// deal page — can call the same functions from the browser. All the logic,
// and the permission check, lives in @/lib/dealVehicles.

export async function linkVehicleToDealAction(
  vehicleId: string,
  dealId: string,
): Promise<LinkResult> {
  const result = await linkVehicleToDeal(vehicleId, dealId);
  if (result.ok) {
    revalidatePath("/lot");
    revalidatePath(`/deals/${dealId}`);
    revalidatePath("/vehicles");
  }
  return result;
}

export async function unlinkVehicleFromDealAction(
  linkId: string,
  dealId: string,
): Promise<UnlinkResult> {
  const result = await unlinkVehicleFromDeal(linkId);
  if (result.ok) {
    revalidatePath("/lot");
    revalidatePath(`/deals/${dealId}`);
  }
  return result;
}

export async function searchDealsAction(q: string): Promise<DealSearchRow[]> {
  await requireCapability("vehicle:linkDeal");
  return searchDealsForLinking(q);
}

export async function searchVehiclesAction(q: string): Promise<VehicleSearchRow[]> {
  await requireCapability("vehicle:linkDeal");
  return searchVehiclesForLinking(q);
}
