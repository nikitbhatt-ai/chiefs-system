// Scratch verification for the check-in save action. Not part of the app.
// Covers the parts that must not be wrong: the transaction is all-or-nothing,
// an existing vehicle's identity is never overwritten, and the ownership /
// lot-status gates are decided from the SESSION rather than from what the
// form posted.
//
// Run against a THROWAWAY database:
//   POSTGRES_URL=... npx tsx scripts/verify-check-in.ts
//
// @/auth and next/cache are stubbed through require.cache before the action is
// imported, so the real server action runs outside a Next request context.

import type { Role } from "../src/lib/rbac";

let sessionRole: Role = "admin";
let sessionUserId = "";

const authPath = require.resolve("../src/auth.ts");
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    // __esModule so esbuild's interop hands the dynamic import our shape
    // directly, rather than wrapping it as { default: ... }.
    __esModule: true,
    auth: async () => ({ user: { id: sessionUserId, role: sessionRole, active: true } }),
  },
} as unknown as NodeModule;

const cachePath = require.resolve("next/cache");
require.cache[cachePath] = {
  id: cachePath,
  filename: cachePath,
  loaded: true,
  exports: { __esModule: true, revalidatePath: () => {}, revalidateTag: () => {} },
} as unknown as NodeModule;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const NEW_VIN = "1FTFW1E80PFA12345";
const KNOWN_VIN = "3GCUYDED9NG567890";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function main() {
  const { eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { users, vehicles, vehicleCheckIns, vehicleCheckInPhotos } = await import("../src/db/schema");
  const { saveCheckInAction } = await import("../src/app/lot/check-in/actions");

  // ---- seed ---------------------------------------------------------------
  await db.delete(vehicles).where(inArray(vehicles.vin, [NEW_VIN, KNOWN_VIN]));
  const [user] = await db
    .insert(users)
    .values({ email: `checkin-${Date.now()}@example.test`, name: "Verifier", role: "admin" })
    .returning();
  sessionUserId = user.id;

  const countAll = async () => ({
    vehicles: (await db.select().from(vehicles)).length,
    checkIns: (await db.select().from(vehicleCheckIns)).length,
    photos: (await db.select().from(vehicleCheckInPhotos)).length,
  });

  // ---- 1. a brand-new vehicle --------------------------------------------
  console.log("\nnew vehicle, admin");
  sessionRole = "admin";
  const r1 = await saveCheckInAction(
    { ok: false },
    form({
      vin: NEW_VIN.toLowerCase(),
      year: "2023",
      make: "Ford",
      model: "F-150",
      trim: "Police Responder",
      color: "Black",
      ownership: "sames",
      lotStatus: "on_lot_available",
      odometer: "412",
      fuelLevel: "three_quarter",
      keyCount: "2",
      keyLocation: "Key board, hook 14",
      lotLocation: "Row A-3",
      damageNotes: "Curb rash — front passenger wheel",
      itemsInside: "Owner manual",
      deliveredBy: "Sames transport",
      dropContact: "979-555-0142",
      photos: JSON.stringify([
        { url: "https://example.blob.vercel-storage.com/front.jpg", slot: "front" },
        { url: "https://example.blob.vercel-storage.com/rear.jpg", slot: "rear" },
      ]),
    }),
  );
  check("save succeeded", r1.ok, r1.error ?? "");
  check("reported as a NEW vehicle", r1.saved?.wasNewVehicle === true);
  check("VIN was normalized to uppercase", r1.saved?.vin === NEW_VIN, r1.saved?.vin);

  const [v1] = await db.select().from(vehicles).where(eq(vehicles.vin, NEW_VIN));
  check("vehicle row created", !!v1);
  check("ownership applied for admin", v1?.ownership === "sames", String(v1?.ownership));
  check("lot status applied", v1?.lotStatus === "on_lot_available", String(v1?.lotStatus));
  const ci1 = await db.select().from(vehicleCheckIns).where(eq(vehicleCheckIns.vehicleId, v1.id));
  check("exactly one check-in", ci1.length === 1, String(ci1.length));
  check("odometer stored", ci1[0]?.odometer === 412);
  check("fuel level stored", ci1[0]?.fuelLevel === "three_quarter");
  check("checked_in_by is the session user", ci1[0]?.checkedInBy === user.id);
  const ph1 = await db.select().from(vehicleCheckInPhotos).where(eq(vehicleCheckInPhotos.checkInId, ci1[0].id));
  check("both photos stored against the check-in", ph1.length === 2, String(ph1.length));
  check("photo slots preserved", ph1.map((p) => p.slot).sort().join(",") === "front,rear");

  // ---- 2. same vehicle again — identity must survive ----------------------
  console.log("\nsame vehicle again (re-arrival)");
  const r2 = await saveCheckInAction(
    { ok: false },
    form({
      vin: NEW_VIN,
      // An existing vehicle is not re-asked for identity, so these arrive
      // blank. They must NOT blank the row.
      year: "", make: "", model: "", trim: "", color: "",
      lotStatus: "in_shop",
      odometer: "980",
      photos: "[]",
    }),
  );
  check("save succeeded", r2.ok, r2.error ?? "");
  check("reported as NOT a new vehicle", r2.saved?.wasNewVehicle === false);
  const [v2] = await db.select().from(vehicles).where(eq(vehicles.vin, NEW_VIN));
  check("make survived the re-check-in", v2?.make === "Ford", String(v2?.make));
  check("model survived", v2?.model === "F-150", String(v2?.model));
  check("year survived", v2?.year === 2023, String(v2?.year));
  check("ownership survived (blank must not clear it)", v2?.ownership === "sames", String(v2?.ownership));
  check("lot status DID move", v2?.lotStatus === "in_shop", String(v2?.lotStatus));
  const ci2 = await db.select().from(vehicleCheckIns).where(eq(vehicleCheckIns.vehicleId, v2.id));
  check("a SECOND check-in row, same vehicle row", ci2.length === 2, String(ci2.length));
  check("still exactly one vehicle row for this VIN",
    (await db.select().from(vehicles).where(eq(vehicles.vin, NEW_VIN))).length === 1);

  // ---- 3. warehouse may move it but not classify it -----------------------
  console.log("\nwarehouse (inventory associate)");
  sessionRole = "warehouse";
  const r3 = await saveCheckInAction(
    { ok: false },
    form({
      vin: KNOWN_VIN,
      make: "Chevrolet", model: "Silverado",
      // Posted anyway — the form hides this control, but hiding it stops
      // nobody from sending the field.
      ownership: "chiefs",
      lotStatus: "in_shop",
      photos: "[]",
    }),
  );
  check("save succeeded", r3.ok, r3.error ?? "");
  const [v3] = await db.select().from(vehicles).where(eq(vehicles.vin, KNOWN_VIN));
  check("posted ownership was IGNORED for warehouse", v3?.ownership === null, String(v3?.ownership));
  check("lot status WAS honoured for warehouse", v3?.lotStatus === "in_shop", String(v3?.lotStatus));

  // ---- 4. tech may record an arrival but move nothing ---------------------
  console.log("\ntech");
  sessionRole = "tech";
  const before4 = await countAll();
  const r4 = await saveCheckInAction(
    { ok: false },
    form({ vin: KNOWN_VIN, ownership: "sames", lotStatus: "departed", photos: "[]" }),
  );
  check("tech can still record an arrival", r4.ok, r4.error ?? "");
  const [v4] = await db.select().from(vehicles).where(eq(vehicles.vin, KNOWN_VIN));
  check("posted ownership ignored for tech", v4?.ownership === null, String(v4?.ownership));
  check("posted lot status ignored for tech", v4?.lotStatus === "in_shop", String(v4?.lotStatus));
  const after4 = await countAll();
  check("the check-in itself was still written", after4.checkIns === before4.checkIns + 1);

  // ---- 5. rollback: nothing half-saved ------------------------------------
  console.log("\nrollback");
  sessionRole = "admin";
  const before5 = await countAll();
  const bad = await saveCheckInAction(
    { ok: false },
    form({
      vin: "1FM5K8AB4NGA98765",
      make: "Ford",
      // javascript: URL — rejected by Zod before any write happens.
      photos: JSON.stringify([{ url: "javascript:alert(1)", slot: "front" }]),
    }),
  );
  check("a non-https photo URL is refused", !bad.ok, bad.error ?? "");
  const after5 = await countAll();
  check("no vehicle was created", after5.vehicles === before5.vehicles);
  check("no check-in was created", after5.checkIns === before5.checkIns);
  check("no photo was created", after5.photos === before5.photos);

  // ---- 6. malformed VIN never reaches the database ------------------------
  console.log("\nmalformed VIN");
  const before6 = await countAll();
  for (const badVin of ["", "SHORT", "1FTFW1E80PFA1234I"]) {
    const r = await saveCheckInAction({ ok: false }, form({ vin: badVin, photos: "[]" }));
    check(`"${badVin || "(empty)"}" refused`, !r.ok);
    check(`"${badVin || "(empty)"}" has a field error for the form`, !!r.fieldErrors?.vin);
  }
  const after6 = await countAll();
  check("nothing was written for any malformed VIN",
    after6.vehicles === before6.vehicles && after6.checkIns === before6.checkIns);

  // ---- 7. a garbage photo payload does not crash --------------------------
  console.log("\nmalformed photo payload");
  const r7 = await saveCheckInAction(
    { ok: false },
    form({ vin: NEW_VIN, photos: "{not json" }),
  );
  check("refused with a readable message", !r7.ok && /malformed/i.test(r7.error ?? ""), r7.error ?? "");

  // ---- 8. two people check the same new truck in at once ------------------
  // The realistic race on a lot: the associate and someone in the office both
  // start a check-in for the same arriving vehicle. The unique index on vin
  // plus onConflictDoUpdate must collapse this into ONE vehicle row with two
  // arrival records — never two vehicles, never a lost check-in.
  console.log("\nconcurrent double submit, same new VIN");
  const RACE_VIN = "JH4KA7561PC111333";
  await db.delete(vehicles).where(eq(vehicles.vin, RACE_VIN));
  sessionRole = "admin";
  const [a, b] = await Promise.all([
    saveCheckInAction({ ok: false }, form({ vin: RACE_VIN, make: "Ford", model: "F-250", photos: "[]" })),
    saveCheckInAction({ ok: false }, form({ vin: RACE_VIN, make: "Ford", model: "F-250", photos: "[]" })),
  ]);
  check("both submissions succeeded", a.ok && b.ok, `${a.error ?? ""} ${b.error ?? ""}`);
  const raceRows = await db.select().from(vehicles).where(eq(vehicles.vin, RACE_VIN));
  check("exactly ONE vehicle row exists", raceRows.length === 1, String(raceRows.length));
  const raceCheckIns = await db
    .select()
    .from(vehicleCheckIns)
    .where(eq(vehicleCheckIns.vehicleId, raceRows[0].id));
  check("both arrivals were recorded", raceCheckIns.length === 2, String(raceCheckIns.length));

  // ---- 9. an unknown photo slot is refused --------------------------------
  console.log("\nunknown photo slot");
  const before9 = await countAll();
  const r9 = await saveCheckInAction(
    { ok: false },
    form({
      vin: "1FM5K8AB4NGA98765",
      photos: JSON.stringify([{ url: "https://example.com/x.jpg", slot: "undercarriage" }]),
    }),
  );
  check("refused", !r9.ok, r9.error ?? "");
  const after9 = await countAll();
  check("nothing written", after9.vehicles === before9.vehicles && after9.checkIns === before9.checkIns);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
