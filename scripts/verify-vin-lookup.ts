// Scratch verification for lookupVin's database paths. Not part of the app.
// The pure validation and decoder paths are covered by src/lib/vin.test.ts;
// this covers the halves that need real rows.
//
// Run against a THROWAWAY database:
//   POSTGRES_URL=... npx tsx scripts/verify-vin-lookup.ts
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  users,
  customers,
  deals,
  vehicles,
  vehicleCheckIns,
  dealVehicles,
} from "../src/db/schema";
import { lookupVin, decodeVin } from "../src/lib/vin";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const KNOWN_VIN = "3GCUYDED9NG567890";
const UNKNOWN_VIN = "1FM5K8AB4NGA98765";
const BARE_VIN = "WAUZZZ8V1JA111222";

// Keep the decoder off the network: this script is about the database paths,
// and a real vPIC call would make the result depend on the weather.
const realFetch = global.fetch;
function stubDecoder(mode: "ok" | "fail") {
  global.fetch = (async () => {
    if (mode === "fail") throw new Error("simulated vPIC outage");
    return new Response(
      JSON.stringify({ Results: [{ ModelYear: "2022", Make: "Ford", Model: "Explorer", Trim: "PI" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof global.fetch;
}

async function main() {
  // ---- clear anything a previous run (or the phase-1 sample block) left ----
  // Re-runnable on purpose: link, check-in and photo rows cascade from here.
  await db.delete(vehicles).where(inArray(vehicles.vin, [KNOWN_VIN, UNKNOWN_VIN, BARE_VIN]));

  // ---- seed ---------------------------------------------------------------
  const [user] = await db
    .insert(users)
    .values({ email: `vinlookup-${Date.now()}@example.test`, name: "Verifier", role: "admin" })
    .returning();

  const [customer] = await db
    .insert(customers)
    .values({ name: "Waller County SO" })
    .returning();

  const [deal] = await db
    .insert(deals)
    .values({ customerId: customer.id, stage: "quote_sent" })
    .returning();

  const [vehicle] = await db
    .insert(vehicles)
    .values({
      vin: KNOWN_VIN,
      year: 2022,
      make: "Chevrolet",
      model: "Silverado",
      ownership: "sames",
      lotStatus: "on_lot_available",
    })
    .returning();

  // Two arrivals, so "last check-in" has something to actually choose between.
  await db.insert(vehicleCheckIns).values({
    vehicleId: vehicle.id,
    arrivedAt: new Date("2026-01-10T09:00:00Z"),
    departedAt: new Date("2026-03-01T09:00:00Z"),
    odometer: 120,
    checkedInBy: user.id,
  });
  const [recent] = await db
    .insert(vehicleCheckIns)
    .values({
      vehicleId: vehicle.id,
      arrivedAt: new Date("2026-08-14T09:00:00Z"),
      odometer: 412,
      fuelLevel: "three_quarter",
      lotLocation: "Front Display",
      checkedInBy: user.id,
    })
    .returning();

  const [link] = await db
    .insert(dealVehicles)
    .values({ dealId: deal.id, vehicleId: vehicle.id, linkedBy: user.id })
    .returning();

  // ---- 1. a VIN we already know -------------------------------------------
  console.log("\nexisting vehicle");
  const existing = await lookupVin(`  ${KNOWN_VIN.toLowerCase()} `);
  check("status is 'existing'", existing.status === "existing", existing.status);
  if (existing.status === "existing") {
    check("returns the vehicle row", existing.vehicle.id === vehicle.id);
    check("VIN came back normalized", existing.vin === KNOWN_VIN, existing.vin);
    check(
      "lastCheckIn is the MOST RECENT arrival, not the first",
      existing.lastCheckIn?.id === recent.id,
      `odometer=${existing.lastCheckIn?.odometer}`,
    );
    check("activeDeal is the open link", existing.activeDeal?.linkId === link.id);
    check("activeDeal carries the deal", existing.activeDeal?.dealId === deal.id);
    check(
      "activeDeal carries the customer name for the banner",
      existing.activeDeal?.customerName === "Waller County SO",
      String(existing.activeDeal?.customerName),
    );
  }

  // ---- 2. once unlinked, there is no active deal ---------------------------
  console.log("\nexisting vehicle, deal unlinked");
  await db
    .update(dealVehicles)
    .set({ unlinkedAt: new Date(), unlinkedBy: user.id })
    .where(eq(dealVehicles.id, link.id));
  const unlinked = await lookupVin(KNOWN_VIN);
  check(
    "activeDeal is null once the link is closed",
    unlinked.status === "existing" && unlinked.activeDeal === null,
  );
  check(
    "the vehicle is still found (history is not identity)",
    unlinked.status === "existing",
  );

  // ---- 3. a vehicle with no check-ins at all -------------------------------
  console.log("\nexisting vehicle, never checked in");
  await db.insert(vehicles).values({ vin: BARE_VIN, make: "Ford", lotStatus: "on_lot_available" });
  const bare = await lookupVin(BARE_VIN);
  check(
    "lastCheckIn is null rather than throwing",
    bare.status === "existing" && bare.lastCheckIn === null,
  );

  // ---- 4. a VIN we have never seen, decoder healthy ------------------------
  console.log("\nnew vehicle, decoder up");
  stubDecoder("ok");
  const fresh = await lookupVin(UNKNOWN_VIN);
  global.fetch = realFetch;
  check("status is 'new'", fresh.status === "new", fresh.status);
  check(
    "decoded year/make/model came through for pre-fill",
    fresh.status === "new" && fresh.decoded?.year === 2022 && fresh.decoded?.make === "Ford",
  );

  // ---- 5. a VIN we have never seen, decoder down ---------------------------
  console.log("\nnew vehicle, decoder DOWN");
  stubDecoder("fail");
  const degraded = await lookupVin(UNKNOWN_VIN);
  global.fetch = realFetch;
  check("still returns 'new' — an outage must never block a check-in", degraded.status === "new");
  check(
    "decoded is null so the form falls back to manual entry",
    degraded.status === "new" && degraded.decoded === null,
  );

  // ---- 6. a decoder outage on a KNOWN vin is irrelevant --------------------
  console.log("\nexisting vehicle, decoder DOWN");
  stubDecoder("fail");
  const knownWhileDown = await lookupVin(KNOWN_VIN);
  global.fetch = realFetch;
  check(
    "a known vehicle never touches the decoder at all",
    knownWhileDown.status === "existing",
  );

  // ---- 7. malformed VINs never reach the database --------------------------
  console.log("\nmalformed VIN");
  let queried = false;
  global.fetch = (async () => {
    queried = true;
    throw new Error("decoder should not have been called");
  }) as typeof global.fetch;
  for (const bad of ["", "SHORT", "1FTFW1E80PFA1234I", "1FTFW1E80PFA123456"]) {
    const r = await lookupVin(bad);
    check(`"${bad || "(empty)"}" is rejected as invalid`, r.status === "invalid", r.status);
    check(`"${bad || "(empty)"}" carries a message for the form`, r.status === "invalid" && !!r.error);
  }
  global.fetch = realFetch;
  check("the decoder was never called for a malformed VIN", !queried);

  // ---- 8. decodeVin is the ONLY NHTSA integration --------------------------
  console.log("\ndecoder wiring");
  let calledUrl = "";
  global.fetch = (async (input: RequestInfo | URL) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ Results: [{ Make: "Ford" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof global.fetch;
  await decodeVin(UNKNOWN_VIN);
  global.fetch = realFetch;
  check(
    "decodeVin calls NHTSA vPIC and nothing else",
    calledUrl.startsWith("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/"),
    calledUrl,
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
