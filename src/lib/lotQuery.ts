// The lot view query. SERVER ONLY — it imports the database.
// Shared vocabulary and the days-on-lot maths live in `@/lib/lot`, which is
// safe for client components to import.

import { and, desc, eq, ilike, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  vehicles,
  vehicleCheckIns,
  vehicleCheckInPhotos,
  dealVehicles,
  deals,
  customers,
} from "@/db/schema";
import type { LotFilters, LotStatus, Ownership } from "@/lib/lot";

export type LotRow = {
  vehicleId: string;
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  ownership: Ownership | null;
  lotStatus: LotStatus;
  lotLocation: string | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
  checkInId: string | null;
  frontPhotoUrl: string | null;
  dealId: string | null;
  dealStage: string | null;
  customerName: string | null;
};


export async function getLotRows(filters: LotFilters = {}): Promise<LotRow[]> {
  // Most recent arrival per vehicle. DISTINCT ON is the cheap way to say
  // "one row per vehicle, the newest one" in Postgres.
  const latest = db
    .selectDistinctOn([vehicleCheckIns.vehicleId], {
      id: vehicleCheckIns.id,
      vehicleId: vehicleCheckIns.vehicleId,
      arrivedAt: vehicleCheckIns.arrivedAt,
      departedAt: vehicleCheckIns.departedAt,
      lotLocation: vehicleCheckIns.lotLocation,
    })
    .from(vehicleCheckIns)
    .orderBy(vehicleCheckIns.vehicleId, desc(vehicleCheckIns.arrivedAt))
    .as("latest_check_in");

  // One front photo per check-in, for the thumbnail.
  const frontPhoto = db
    .selectDistinctOn([vehicleCheckInPhotos.checkInId], {
      checkInId: vehicleCheckInPhotos.checkInId,
      url: vehicleCheckInPhotos.url,
    })
    .from(vehicleCheckInPhotos)
    .where(eq(vehicleCheckInPhotos.slot, "front"))
    .orderBy(vehicleCheckInPhotos.checkInId, desc(vehicleCheckInPhotos.createdAt))
    .as("front_photo");

  const where: SQL[] = [];

  if (filters.lotStatus) {
    where.push(eq(vehicles.lotStatus, filters.lotStatus));
  } else if (!filters.includeDeparted) {
    where.push(ne(vehicles.lotStatus, "departed"));
  }

  if (filters.ownership === "unset") {
    where.push(isNull(vehicles.ownership));
  } else if (filters.ownership) {
    where.push(eq(vehicles.ownership, filters.ownership));
  }

  if (filters.deal === "has") where.push(isNotNull(dealVehicles.id));
  if (filters.deal === "none") where.push(isNull(dealVehicles.id));

  const q = filters.q?.trim();
  if (q) {
    const like = `%${q}%`;
    const match = or(
      ilike(vehicles.vin, like),
      ilike(vehicles.make, like),
      ilike(vehicles.model, like),
    );
    if (match) where.push(match);
  }

  return db
    .select({
      vehicleId: vehicles.id,
      vin: vehicles.vin,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
      ownership: vehicles.ownership,
      lotStatus: vehicles.lotStatus,
      // The vehicle row is the current truth; the arrival record is the
      // fallback for anything checked in before the column was populated.
      lotLocation: sql<string | null>`coalesce(${vehicles.lotLocation}, ${latest.lotLocation})`,
      arrivedAt: latest.arrivedAt,
      departedAt: latest.departedAt,
      checkInId: latest.id,
      frontPhotoUrl: frontPhoto.url,
      dealId: deals.id,
      dealStage: deals.stage,
      customerName: customers.name,
    })
    .from(vehicles)
    .leftJoin(latest, eq(latest.vehicleId, vehicles.id))
    .leftJoin(frontPhoto, eq(frontPhoto.checkInId, latest.id))
    // The CURRENT deal only — the partial unique index guarantees at most one.
    .leftJoin(
      dealVehicles,
      and(eq(dealVehicles.vehicleId, vehicles.id), isNull(dealVehicles.unlinkedAt)),
    )
    .leftJoin(deals, eq(deals.id, dealVehicles.dealId))
    .leftJoin(customers, eq(customers.id, deals.customerId))
    .where(where.length ? and(...where) : undefined)
    // Longest-sitting first: the units quietly costing money surface at the
    // top. Vehicles with no arrival on record have nothing to measure, so they
    // sort last rather than pretending to be new.
    .orderBy(
      sql`(coalesce(${latest.departedAt}, now()) - ${latest.arrivedAt}) desc nulls last`,
      desc(vehicles.createdAt),
    ) as Promise<LotRow[]>;
}
