// Scratch verification for vehicle-to-deal linking. Not part of the app.
// Covers the rules the brief is precise about: the refusal names the existing
// deal, lot status is promoted only from `available`, deal fields are filled
// only where blank, unlinking never deletes, and the whole thing is gated on
// the server rather than by which buttons were drawn.
//
// Run against a THROWAWAY database:
//   POSTGRES_URL=... npx tsx scripts/verify-deal-linking.ts

import type { Role } from "../src/lib/rbac";

let sessionRole: Role = "admin";
let sessionUserId = "";

const authPath = require.resolve("../src/auth.ts");
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    __esModule: true,
    auth: async () => ({ user: { id: sessionUserId, role: sessionRole, active: true } }),
  },
} as unknown as NodeModule;
const cachePath = require.resolve("next/cache");
require.cache[cachePath] = {
  id: cachePath, filename: cachePath, loaded: true,
  exports: { __esModule: true, revalidatePath: () => {}, revalidateTag: () => {} },
} as unknown as NodeModule;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const VINS = {
  free: "1HGCM82633A004352",
  available: "3GCUYDED9NG567890",
  inShop: "1FM5K8AB4NGA98765",
  second: "1FTFW1E80PFA12345",
  departed: "JH4KA7561PC111333",
};

async function main() {
  const { eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { users, customers, deals, vehicles, dealVehicles } = await import("../src/db/schema");
  const {
    linkVehicleToDeal, unlinkVehicleFromDeal, getDealVehicles, searchVehiclesForLinking, searchDealsForLinking,
  } = await import("../src/lib/dealVehicles");

  await db.delete(vehicles).where(inArray(vehicles.vin, Object.values(VINS)));
  const [user] = await db.insert(users)
    .values({ email: `link-${Date.now()}@example.test`, name: "Verifier", role: "admin" })
    .returning();
  sessionUserId = user.id;

  const [waller] = await db.insert(customers).values({ name: "Waller County SO" }).returning();
  const [austin] = await db.insert(customers).values({ name: "Austin PD" }).returning();

  // A blank deal, and one that already names a different vehicle.
  const [blankDeal] = await db.insert(deals).values({ customerId: waller.id, stage: "quote_sent" }).returning();
  const [filledDeal] = await db.insert(deals).values({
    customerId: austin.id, stage: "po_received",
    vin: "EXISTINGVIN000001", vehicleYear: 2011, vehicleMake: "Crown", vehicleModel: "Victoria",
  }).returning();

  const mk = async (vin: string, over: Record<string, unknown>) =>
    (await db.insert(vehicles).values({ vin, ...over } as never).returning())[0];

  const available = await mk(VINS.available, { year: 2022, make: "Chevrolet", model: "Silverado", ownership: "sames", lotStatus: "on_lot_available" });
  const inShop = await mk(VINS.inShop, { year: 2022, make: "Ford", model: "Explorer", ownership: "customer", lotStatus: "in_shop" });
  const second = await mk(VINS.second, { year: 2023, make: "Ford", model: "F-150", lotStatus: "on_lot_available" });
  await mk(VINS.departed, { year: 2019, make: "Dodge", model: "Durango", lotStatus: "departed" });

  const vehicleRow = async (id: string) => (await db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
  const dealRow = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

  // ---- 1. the happy path --------------------------------------------------
  console.log("\nattach an available vehicle to a blank deal");
  const r1 = await linkVehicleToDeal(available.id, blankDeal.id);
  check("link succeeded", r1.ok, r1.ok ? "" : r1.error);
  check("lot status promoted to on_lot_assigned",
    (await vehicleRow(available.id)).lotStatus === "on_lot_assigned",
    (await vehicleRow(available.id)).lotStatus);
  const bd = await dealRow(blankDeal.id);
  check("VIN copied onto the blank deal", bd.vin === VINS.available, String(bd.vin));
  check("year copied", bd.vehicleYear === 2022, String(bd.vehicleYear));
  check("make copied", bd.vehicleMake === "Chevrolet", String(bd.vehicleMake));
  check("model copied", bd.vehicleModel === "Silverado", String(bd.vehicleModel));
  check("linked_by recorded", (await getDealVehicles(blankDeal.id))[0].linkedByName === "Verifier");

  // ---- 2. refusing a second deal, BY NAME ---------------------------------
  console.log("\nthe same vehicle onto a second deal");
  const r2 = await linkVehicleToDeal(available.id, filledDeal.id);
  check("refused", !r2.ok);
  check("the error NAMES the deal it is already on",
    !r2.ok && r2.error.includes("Waller County SO"), r2.ok ? "" : r2.error);
  const again = await linkVehicleToDeal(available.id, blankDeal.id);
  check("re-attaching to the SAME deal says so plainly",
    !again.ok && /already on this deal/i.test(again.error), again.ok ? "" : again.error);

  // ---- 3. in_shop must not be clobbered -----------------------------------
  console.log("\nattach a vehicle that is in a bay");
  const r3 = await linkVehicleToDeal(inShop.id, filledDeal.id);
  check("link succeeded", r3.ok, r3.ok ? "" : r3.error);
  check("lot status stayed in_shop — paperwork does not move a vehicle",
    (await vehicleRow(inShop.id)).lotStatus === "in_shop",
    (await vehicleRow(inShop.id)).lotStatus);

  // ---- 4. never overwrite what the deal already says ----------------------
  console.log("\ndeal fields already filled in");
  const fd = await dealRow(filledDeal.id);
  check("existing VIN untouched", fd.vin === "EXISTINGVIN000001", String(fd.vin));
  check("existing year untouched", fd.vehicleYear === 2011, String(fd.vehicleYear));
  check("existing make untouched", fd.vehicleMake === "Crown", String(fd.vehicleMake));
  check("existing model untouched", fd.vehicleModel === "Victoria", String(fd.vehicleModel));

  // ---- 5. a deal may carry several vehicles -------------------------------
  console.log("\nseveral vehicles on one deal");
  const r5 = await linkVehicleToDeal(second.id, filledDeal.id);
  check("second vehicle attached to the same deal", r5.ok, r5.ok ? "" : r5.error);
  const onFilled = (await getDealVehicles(filledDeal.id)).filter((v) => !v.unlinkedAt);
  check("the deal now carries two", onFilled.length === 2, String(onFilled.length));

  // ---- 6. unlink stamps, never deletes ------------------------------------
  console.log("\ndetach");
  const links = await getDealVehicles(blankDeal.id);
  const u = await unlinkVehicleFromDeal(links[0].linkId);
  check("unlink succeeded", u.ok, u.ok ? "" : u.error);
  const after = await getDealVehicles(blankDeal.id);
  check("the row still EXISTS — history is the point", after.length === 1, String(after.length));
  check("stamped unlinked_at", !!after[0].unlinkedAt);
  check("stamped unlinked_by",
    (await db.select().from(dealVehicles).where(eq(dealVehicles.id, links[0].linkId)))[0].unlinkedBy === user.id);
  const u2 = await unlinkVehicleFromDeal(links[0].linkId);
  check("detaching twice is refused, not silently repeated", !u2.ok, u2.ok ? "" : u2.error);

  console.log("\nre-attach after detaching");
  const r6 = await linkVehicleToDeal(available.id, filledDeal.id);
  check("the freed vehicle can move to another deal", r6.ok, r6.ok ? "" : r6.error);
  const history = await getDealVehicles(blankDeal.id);
  check("the old deal keeps its history row", history.length === 1);

  // ---- 7. search ----------------------------------------------------------
  console.log("\nsearch");
  const browse = await searchVehiclesForLinking("");
  check("browse defaults to on-lot unassigned",
    browse.every((v) => v.lotStatus === "on_lot_available"), browse.map((v) => v.lotStatus).join(","));
  check("a vehicle already on a deal is not offered",
    !browse.some((v) => v.id === available.id || v.id === inShop.id));
  check("a departed vehicle is not offered", !browse.some((v) => v.vin === VINS.departed));
  const byVin = await searchVehiclesForLinking(VINS.departed);
  check("searching still excludes departed and linked vehicles", byVin.length === 0, String(byVin.length));
  const dealsFound = await searchDealsForLinking("waller");
  check("deal search by customer name is case-insensitive",
    dealsFound.some((d) => d.id === blankDeal.id), String(dealsFound.length));
  const byId = await searchDealsForLinking(blankDeal.id.slice(0, 8));
  check("deal search by the short id shown on the deal page",
    byId.some((d) => d.id === blankDeal.id), String(byId.length));

  // ---- 8. the server gate -------------------------------------------------
  console.log("\npermissions");
  const [spare] = await db.insert(deals).values({ customerId: waller.id, stage: "prospect" }).returning();
  for (const role of ["warehouse", "tech", "accountant"] as Role[]) {
    sessionRole = role;
    const res = await linkVehicleToDeal(second.id, spare.id);
    check(`${role} is refused even calling directly`, !res.ok, res.ok ? "" : res.error);
  }
  sessionRole = "warehouse";
  const wu = await unlinkVehicleFromDeal((await getDealVehicles(filledDeal.id))[0].linkId);
  check("warehouse cannot detach either", !wu.ok, wu.ok ? "" : wu.error);
  // A genuinely free vehicle — `second` is already on a deal by this point,
  // so reusing it would test the refusal path rather than the role.
  const free = await mk("1HGCM82633A004352", { year: 2020, make: "Honda", model: "Accord", lotStatus: "on_lot_available" });
  sessionRole = "sales";
  const salesLink = await linkVehicleToDeal(free.id, spare.id);
  check("sales (office) CAN link", salesLink.ok, salesLink.ok ? "" : salesLink.error);
  sessionRole = "admin";

  // ---- 9. missing rows ----------------------------------------------------
  console.log("\nbad input");
  const ghost = await linkVehicleToDeal("00000000-0000-4000-a000-000000000999", blankDeal.id);
  check("a vehicle that does not exist is refused cleanly", !ghost.ok, ghost.ok ? "" : ghost.error);
  const noDeal = await linkVehicleToDeal(second.id, "00000000-0000-4000-a000-000000000998");
  check("a deal that does not exist is refused cleanly", !noDeal.ok, noDeal.ok ? "" : noDeal.error);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
