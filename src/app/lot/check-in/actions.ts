"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { vehicles, vehicleCheckIns, vehicleCheckInPhotos } from "@/db/schema";
import { lookupVin, vinSchema, type VinLookupResult } from "@/lib/vin";
import { can, requireCapability, PermissionError } from "@/lib/rbac";

// ---------------------------------------------------------------------------
// Step 1 — VIN lookup
// ---------------------------------------------------------------------------

export async function lookupVinAction(vin: string): Promise<VinLookupResult> {
  await requireCapability("checkin:create");
  return lookupVin(vin);
}

// ---------------------------------------------------------------------------
// Step 4 — save
// ---------------------------------------------------------------------------

const OWNERSHIP = ["chiefs", "customer", "sames"] as const;
const LOT_STATUS = ["on_lot_available", "on_lot_assigned", "in_shop", "departed"] as const;
const FUEL = ["empty", "quarter", "half", "three_quarter", "full"] as const;
const SLOTS = [
  "front",
  "rear",
  "driver_side",
  "passenger_side",
  "odometer",
  "vin_plate",
  "damage",
] as const;

// "" from an untouched input means "not answered", not "empty string".
const optionalText = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalInt = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : v.trim()))
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= max), {
      message: "Enter a whole number.",
    })
    .nullable()
    .optional();

// Photos arrive as URLs the browser already uploaded to Vercel Blob. Restricted
// to https so a hand-crafted POST cannot stash a javascript: or data: URL in a
// column the lot view renders as an <img>.
const photoSchema = z.object({
  url: z.string().url().max(2000).startsWith("https://", "Photos must be https URLs."),
  slot: z.enum(SLOTS).nullable().optional(),
});

const checkInSchema = z.object({
  vin: vinSchema,
  // Identity fields. Only ever applied when the vehicle row is NEW — an
  // existing vehicle is not re-asked for them, and must not be overwritten.
  year: optionalInt(9999),
  make: optionalText,
  model: optionalText,
  trim: optionalText,
  color: optionalText,
  // Classification. Both are re-checked against the caller's role below;
  // presence here does not mean they will be applied.
  ownership: z.enum(OWNERSHIP).nullable().optional(),
  lotStatus: z.enum(LOT_STATUS).optional(),
  // Arrival detail.
  odometer: optionalInt(9_999_999),
  fuelLevel: z.enum(FUEL).nullable().optional(),
  keyCount: optionalInt(20),
  keyLocation: optionalText,
  deliveredBy: optionalText,
  dropContact: optionalText,
  lotLocation: optionalText,
  damageNotes: optionalText,
  itemsInside: optionalText,
  photos: z.array(photoSchema).max(40).default([]),
});

export type CheckInState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  saved?: { checkInId: string; vin: string; wasNewVehicle: boolean };
};

export async function saveCheckInAction(
  _prev: CheckInState,
  formData: FormData,
): Promise<CheckInState> {
  // Everyone may record an arrival. What they may CLASSIFY is narrower, and is
  // decided below from the session — never from what the form posted.
  let session;
  try {
    session = await requireCapability("checkin:create");
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, error: e.message };
    throw e;
  }

  let photos: unknown = [];
  try {
    photos = JSON.parse(String(formData.get("photos") ?? "[]"));
  } catch {
    return { ok: false, error: "Photo list was malformed. Nothing was saved." };
  }

  const parsed = checkInSchema.safeParse({
    vin: formData.get("vin") ?? "",
    year: formData.get("year") ?? "",
    make: formData.get("make") ?? "",
    model: formData.get("model") ?? "",
    trim: formData.get("trim") ?? "",
    color: formData.get("color") ?? "",
    ownership: (formData.get("ownership") || null) as string | null,
    lotStatus: (formData.get("lotStatus") || undefined) as string | undefined,
    odometer: formData.get("odometer") ?? "",
    fuelLevel: (formData.get("fuelLevel") || null) as string | null,
    keyCount: formData.get("keyCount") ?? "",
    keyLocation: formData.get("keyLocation") ?? "",
    deliveredBy: formData.get("deliveredBy") ?? "",
    dropContact: formData.get("dropContact") ?? "",
    lotLocation: formData.get("lotLocation") ?? "",
    damageNotes: formData.get("damageNotes") ?? "",
    itemsInside: formData.get("itemsInside") ?? "",
    photos,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      ok: false,
      error: fieldErrors.vin ?? "Some details need fixing. Nothing was saved.",
      fieldErrors,
    };
  }

  const d = parsed.data;

  // Server-side permission gates. The form hides these controls, but hiding a
  // control stops nobody from posting the field — the decision is made here.
  const mayClassify = can(session, "vehicle:setOwnership");
  const mayMove = can(session, "vehicle:setLotStatus");

  const ownership = mayClassify ? (d.ownership ?? null) : null;
  const lotStatus = mayMove ? (d.lotStatus ?? "on_lot_available") : "on_lot_available";

  try {
    const saved = await db.transaction(async (tx) => {
      // Upsert on the VIN. On conflict we touch ONLY the physical/commercial
      // state — never year/make/model — so re-checking in a known vehicle
      // cannot blank out its identity. The unique index on vin makes this
      // atomic, so two people checking the same truck in at once cannot
      // create two vehicle rows.
      const [vehicle] = await tx
        .insert(vehicles)
        .values({
          vin: d.vin,
          year: d.year ?? null,
          make: d.make ?? null,
          model: d.model ?? null,
          trim: d.trim ?? null,
          color: d.color ?? null,
          ownership,
          lotStatus,
          lotLocation: d.lotLocation ?? null,
        })
        .onConflictDoUpdate({
          target: vehicles.vin,
          set: {
            // Ownership is only ever SET, never cleared: an inventory
            // associate leaving it blank must not wipe what office chose.
            ...(ownership ? { ownership } : {}),
            // Lot status only moves for someone allowed to move it.
            ...(mayMove ? { lotStatus } : {}),
            ...(d.lotLocation ? { lotLocation: d.lotLocation } : {}),
            updatedAt: new Date(),
          },
        })
        .returning({ id: vehicles.id, createdAt: vehicles.createdAt, updatedAt: vehicles.updatedAt });

      const [checkIn] = await tx
        .insert(vehicleCheckIns)
        .values({
          vehicleId: vehicle.id,
          odometer: d.odometer ?? null,
          fuelLevel: d.fuelLevel ?? null,
          keyCount: d.keyCount ?? null,
          keyLocation: d.keyLocation ?? null,
          deliveredBy: d.deliveredBy ?? null,
          dropContact: d.dropContact ?? null,
          lotLocation: d.lotLocation ?? null,
          damageNotes: d.damageNotes ?? null,
          itemsInside: d.itemsInside ?? null,
          checkedInBy: session.user.id,
        })
        .returning({ id: vehicleCheckIns.id });

      if (d.photos.length > 0) {
        await tx.insert(vehicleCheckInPhotos).values(
          d.photos.map((p) => ({
            checkInId: checkIn.id,
            url: p.url,
            slot: p.slot ?? null,
          })),
        );
      }

      return {
        checkInId: checkIn.id,
        vin: d.vin,
        // A brand-new row has createdAt === updatedAt; the upsert bumps
        // updatedAt on an existing one.
        wasNewVehicle: vehicle.createdAt.getTime() === vehicle.updatedAt.getTime(),
      };
    });

    // Refresh anything showing the lot. The app uses server components and
    // revalidatePath rather than react-query (which is a dependency here but
    // is not used anywhere in src/), so this is the equivalent cache bust.
    revalidatePath("/lot");
    revalidatePath("/lot/check-in");
    revalidatePath("/vehicles");

    return { ok: true, saved };
  } catch (e) {
    // The transaction rolled back, so there is no half-saved check-in.
    const msg = (e as Error).message || "Could not save the check-in.";
    return { ok: false, error: `Nothing was saved — ${msg}` };
  }
}

// Kept separate from the vehicle upsert so the form can offer a plain retry
// without re-uploading photos.
export async function getVehicleSummary(vin: string) {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.vin, vin)).limit(1);
  return row ?? null;
}
