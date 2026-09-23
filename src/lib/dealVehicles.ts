// Linking a vehicle to a deal.
//
// The vehicle owns physical reality; the deal owns commercial reality. This is
// the join between them, and it is a link TABLE rather than a column because a
// deal can carry several vehicles and a vehicle moves across several deals over
// its life. A vehicle's CURRENT deal is the row with `unlinked_at IS NULL`; its
// history is every row, and unlinking never deletes.
//
// What this file deliberately does NOT do: purchase-order checks, bay
// scheduling, parts. Linking makes a vehicle ELIGIBLE for scheduling; the
// scheduler enforces the PO gate. That rule lives in one place and this is not
// it.

import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { vehicles, deals, customers, dealVehicles, users } from "@/db/schema";
import { requireCapability, PermissionError } from "@/lib/rbac";

export type LinkResult =
  | { ok: true; linkId: string }
  | { ok: false; error: string };

export type UnlinkResult = { ok: true } | { ok: false; error: string };

function describeDeal(customerName: string | null, dealId: string): string {
  return customerName ? `${customerName} (deal ${dealId.slice(0, 8)})` : `deal ${dealId.slice(0, 8)}`;
}

export async function linkVehicleToDeal(
  vehicleId: string,
  dealId: string,
): Promise<LinkResult> {
  // 1. Office or admin only. Attaching a vehicle to a deal is a commercial
  //    act, not a physical one, so it is not the inventory associate's call.
  let session;
  try {
    session = await requireCapability("vehicle:linkDeal");
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, error: e.message };
    throw e;
  }
  const userId = session.user.id;

  try {
    return await db.transaction(async (tx) => {
      const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
      if (!vehicle) return { ok: false as const, error: "That vehicle no longer exists." };

      const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
      if (!deal) return { ok: false as const, error: "That deal no longer exists." };

      // 2. Refuse if it is already on a deal, and say WHICH — "already
      //    linked" sends someone hunting; naming the deal ends it.
      const [existing] = await tx
        .select({ dealId: dealVehicles.dealId, customerName: customers.name })
        .from(dealVehicles)
        .leftJoin(deals, eq(deals.id, dealVehicles.dealId))
        .leftJoin(customers, eq(customers.id, deals.customerId))
        .where(and(eq(dealVehicles.vehicleId, vehicleId), isNull(dealVehicles.unlinkedAt)))
        .limit(1);

      if (existing) {
        if (existing.dealId === dealId) {
          return { ok: false as const, error: "This vehicle is already on this deal." };
        }
        return {
          ok: false as const,
          error: `Already attached to ${describeDeal(existing.customerName, existing.dealId)}. Detach it there first.`,
        };
      }

      // 3. The link itself.
      const [link] = await tx
        .insert(dealVehicles)
        .values({ dealId, vehicleId, linkedBy: userId })
        .returning({ id: dealVehicles.id });

      // 4. It is spoken for now — but only promote it from "available".
      //    A vehicle already in a bay stays `in_shop`: where it physically is
      //    does not change because paperwork did.
      if (vehicle.lotStatus === "on_lot_available") {
        await tx
          .update(vehicles)
          .set({ lotStatus: "on_lot_assigned", updatedAt: new Date() })
          .where(eq(vehicles.id, vehicleId));
      }

      // 5. Fill the deal's own vehicle fields ONLY where they are blank.
      //    coalesce + nullif so an empty string counts as blank, and so a deal
      //    that already names a vehicle is never quietly overwritten.
      await tx
        .update(deals)
        .set({
          vin: sql`coalesce(nullif(btrim(${deals.vin}), ''), ${vehicle.vin})`,
          vehicleYear: sql`coalesce(${deals.vehicleYear}, ${vehicle.year})`,
          vehicleMake: sql`coalesce(nullif(btrim(${deals.vehicleMake}), ''), ${vehicle.make})`,
          vehicleModel: sql`coalesce(nullif(btrim(${deals.vehicleModel}), ''), ${vehicle.model})`,
          updatedAt: new Date(),
        })
        .where(eq(deals.id, dealId));

      return { ok: true as const, linkId: link.id };
    });
  } catch (e) {
    // The partial unique index is the real guard: two people hitting "attach"
    // at the same moment both pass the check above, and one of them lands here.
    const err = e as { code?: string; constraint_name?: string };
    if (err.code === "23505") {
      return {
        ok: false,
        error: "Someone attached this vehicle to a deal a moment ago. Reload and check.",
      };
    }
    return { ok: false, error: (e as Error).message || "Could not attach the vehicle." };
  }
}

// Never deletes. The history is the point — a vehicle that passed through
// three deals should still be able to say so.
export async function unlinkVehicleFromDeal(linkId: string): Promise<UnlinkResult> {
  let session;
  try {
    session = await requireCapability("vehicle:linkDeal");
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, error: e.message };
    throw e;
  }

  const [link] = await db
    .select({ id: dealVehicles.id, unlinkedAt: dealVehicles.unlinkedAt })
    .from(dealVehicles)
    .where(eq(dealVehicles.id, linkId))
    .limit(1);

  if (!link) return { ok: false, error: "That link no longer exists." };
  if (link.unlinkedAt) return { ok: false, error: "That vehicle was already detached." };

  await db
    .update(dealVehicles)
    .set({ unlinkedAt: new Date(), unlinkedBy: session.user.id })
    .where(and(eq(dealVehicles.id, linkId), isNull(dealVehicles.unlinkedAt)));

  // Note what this does NOT do: it leaves `lotStatus` alone. Detaching a
  // vehicle from a deal says nothing about where it physically is — it may
  // still be in a bay. Lot status is changed from the lot view, in one tap.
  return { ok: true };
}

// Every vehicle this deal has ever carried, current links first.
export async function getDealVehicles(dealId: string) {
  return db
    .select({
      linkId: dealVehicles.id,
      vehicleId: vehicles.id,
      vin: vehicles.vin,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
      lotStatus: vehicles.lotStatus,
      lotLocation: vehicles.lotLocation,
      linkedAt: dealVehicles.linkedAt,
      unlinkedAt: dealVehicles.unlinkedAt,
      linkedByName: users.name,
    })
    .from(dealVehicles)
    .innerJoin(vehicles, eq(vehicles.id, dealVehicles.vehicleId))
    .leftJoin(users, eq(users.id, dealVehicles.linkedBy))
    .where(eq(dealVehicles.dealId, dealId))
    .orderBy(sql`${dealVehicles.unlinkedAt} asc nulls first`, desc(dealVehicles.linkedAt));
}

export type DealSearchRow = {
  id: string;
  stage: string;
  customerName: string | null;
  vin: string | null;
  updatedAt: Date;
};

// Search deals by customer name, or by the short id shown on the deal page.
export async function searchDealsForLinking(q: string): Promise<DealSearchRow[]> {
  const term = q.trim();
  const where: SQL[] = [eq(deals.archived, false)];
  if (term) {
    const like = `%${term}%`;
    const match = or(
      ilike(customers.name, like),
      // The deal page titles itself "Deal 3f2a1b9c", so that prefix is what
      // someone will have written down.
      sql`${deals.id}::text ilike ${`${term.toLowerCase()}%`}`,
    );
    if (match) where.push(match);
  }
  return db
    .select({
      id: deals.id,
      stage: deals.stage,
      customerName: customers.name,
      vin: deals.vin,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .leftJoin(customers, eq(customers.id, deals.customerId))
    .where(and(...where))
    .orderBy(desc(deals.updatedAt))
    .limit(20);
}

export type VehicleSearchRow = {
  id: string;
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  lotStatus: string;
  lotLocation: string | null;
};

// Vehicles that can be attached: anything not already on a deal and not gone.
// With no search term this is the browse list, and it is deliberately the
// short one — on lot, unassigned is almost always what is wanted.
export async function searchVehiclesForLinking(q: string): Promise<VehicleSearchRow[]> {
  const term = q.trim();
  const activeLink = db
    .select({ vehicleId: dealVehicles.vehicleId })
    .from(dealVehicles)
    .where(isNull(dealVehicles.unlinkedAt));

  const where: SQL[] = [
    sql`${vehicles.id} not in ${activeLink}`,
    sql`${vehicles.lotStatus} <> 'departed'`,
  ];

  if (term) {
    const like = `%${term}%`;
    const match = or(
      ilike(vehicles.vin, like),
      ilike(vehicles.make, like),
      ilike(vehicles.model, like),
    );
    if (match) where.push(match);
  } else {
    // The default browse list: on lot and unassigned.
    where.push(eq(vehicles.lotStatus, "on_lot_available"));
  }

  return db
    .select({
      id: vehicles.id,
      vin: vehicles.vin,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
      lotStatus: vehicles.lotStatus,
      lotLocation: vehicles.lotLocation,
    })
    .from(vehicles)
    .where(and(...where))
    .orderBy(desc(vehicles.createdAt))
    .limit(30) as Promise<VehicleSearchRow[]>;
}
