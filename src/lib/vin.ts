// VIN validation, decoding, and lookup.
//
// The NHTSA vPIC decode used to live inline in
// `src/app/api/vin/decode/[vin]/route.ts`. It is extracted here so the server
// can call it directly: a server action reaching its own HTTP route would pay
// a second round trip and re-do auth for no reason. Same service, same
// endpoint — this is the one and only VIN decoder in the system, and that
// route now calls it too.

import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  vehicles,
  vehicleCheckIns,
  dealVehicles,
  deals,
  customers,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// I, O and Q are never used in a real VIN — they were excluded to avoid
// confusion with the digits 1 and 0. Their presence means a typo.
// Same rule as `vinToShopify/validate.js`.
const VIN_CHARS = /^[A-HJ-NPR-Z0-9]+$/;

// Normalizes before it validates, so " 1ftfw1e80pfa12345 " is accepted and
// stored as "1FTFW1E80PFA12345".
export const vinSchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(
    z
      .string()
      .length(17, "A VIN is exactly 17 characters.")
      .regex(VIN_CHARS, "A VIN uses letters and digits only, and never I, O or Q."),
  );

export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export type DecodedVin = {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
  fuelType: string | null;
  raw: Record<string, unknown>;
};

// { ok, data } | { ok, error } — the same shape `vinToShopify/decodeVin.js`
// already returns, so both decoders read alike.
export type DecodeResult =
  | { ok: true; data: DecodedVin }
  | { ok: false; error: string };

const NHTSA_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

// Someone standing on gravel with one bar should not watch a spinner forever
// because vPIC is slow. Past this, treat it as a failure and let them type the
// year/make/model in by hand.
const DECODE_TIMEOUT_MS = 8_000;

// Never throws. Every failure path — offline, timeout, 500, malformed body —
// comes back as { ok: false }, because a decoder outage must never block a
// check-in.
export async function decodeVin(vin: string): Promise<DecodeResult> {
  const cleanVin = normalizeVin(vin);
  const url = `${NHTSA_URL}/${encodeURIComponent(cleanVin)}?format=json`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(DECODE_TIMEOUT_MS),
    });
  } catch (e) {
    const reason = (e as Error)?.name === "TimeoutError" ? "timed out" : "network error";
    return { ok: false, error: `Could not reach the VIN service (${reason}).` };
  }

  if (!res.ok) {
    return { ok: false, error: `VIN service returned HTTP ${res.status}.` };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: "VIN service returned a response we could not read." };
  }

  const result = (payload as { Results?: Record<string, unknown>[] })?.Results?.[0];
  if (!result) {
    return { ok: false, error: "VIN service returned no results." };
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const year = Number(result.ModelYear);

  return {
    ok: true,
    data: {
      vin: cleanVin,
      year: Number.isFinite(year) && year > 0 ? year : null,
      make: str(result.Make),
      model: str(result.Model),
      trim: str(result.Trim),
      bodyClass: str(result.BodyClass),
      fuelType: str(result.FuelTypePrimary),
      raw: result,
    },
  };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export type ExistingVehicle = typeof vehicles.$inferSelect;
export type LastCheckIn = typeof vehicleCheckIns.$inferSelect;

export type ActiveDeal = {
  linkId: string;
  dealId: string;
  linkedAt: Date;
  stage: string;
  customerName: string | null;
};

export type VinLookupResult =
  // The VIN itself is wrong — 17 characters, no I/O/Q. The form shows this
  // inline; nothing was looked up.
  | { status: "invalid"; vin: string; error: string }
  // We already know this vehicle. The form shows a banner and collects arrival
  // details only — it must not re-ask for identity fields.
  | {
      status: "existing";
      vin: string;
      vehicle: ExistingVehicle;
      lastCheckIn: LastCheckIn | null;
      activeDeal: ActiveDeal | null;
    }
  // First time we have seen it. `decoded` is null when the decoder failed —
  // the form falls back to manual entry rather than blocking the check-in.
  | { status: "new"; vin: string; decoded: DecodedVin | null };

// What the check-in form needs to know about a VIN, in one call.
export async function lookupVin(vin: string): Promise<VinLookupResult> {
  const parsed = vinSchema.safeParse(vin);
  if (!parsed.success) {
    return {
      status: "invalid",
      vin: normalizeVin(vin ?? ""),
      error: parsed.error.issues[0]?.message ?? "That VIN is not valid.",
    };
  }
  const cleanVin = parsed.data;

  const [vehicle] = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.vin, cleanVin))
    .limit(1);

  if (!vehicle) {
    // Unknown vehicle: decode for the form's benefit, but never let a decoder
    // outage stop the check-in. A failure just means manual entry.
    const decoded = await decodeVin(cleanVin);
    return {
      status: "new",
      vin: cleanVin,
      decoded: decoded.ok ? decoded.data : null,
    };
  }

  // Most recent arrival, open or closed — the form shows its last known state.
  const [lastCheckIn] = await db
    .select()
    .from(vehicleCheckIns)
    .where(eq(vehicleCheckIns.vehicleId, vehicle.id))
    .orderBy(desc(vehicleCheckIns.arrivedAt))
    .limit(1);

  // The CURRENT deal is the link row that has not been unlinked. The partial
  // unique index guarantees there is at most one.
  const [activeDeal] = await db
    .select({
      linkId: dealVehicles.id,
      dealId: dealVehicles.dealId,
      linkedAt: dealVehicles.linkedAt,
      stage: deals.stage,
      customerName: customers.name,
    })
    .from(dealVehicles)
    .innerJoin(deals, eq(deals.id, dealVehicles.dealId))
    .leftJoin(customers, eq(customers.id, deals.customerId))
    .where(
      and(
        eq(dealVehicles.vehicleId, vehicle.id),
        isNull(dealVehicles.unlinkedAt),
      ),
    )
    .limit(1);

  return {
    status: "existing",
    vin: cleanVin,
    vehicle,
    lastCheckIn: lastCheckIn ?? null,
    activeDeal: activeDeal ?? null,
  };
}
