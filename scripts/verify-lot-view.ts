// Scratch verification for the lot view query. Not part of the app.
// The days-on-lot arithmetic is unit-tested in src/lib/lot.test.ts; this
// covers what only a database can answer — the joins, the filters, and the
// ordering that puts the longest-sitting units on top.
//
// Run against a THROWAWAY database:
//   POSTGRES_URL=... npx tsx scripts/verify-lot-view.ts

import { eq, inArray } from "drizzle-orm";
import type { Role } from "../src/lib/rbac";

// @/auth and next/cache stubbed through require.cache before the inline
// lot-status action is imported, so the real server action runs outside a Next
// request context. __esModule so esbuild's interop hands the dynamic import our
// shape directly rather than wrapping it as { default: ... }.
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
import { db } from "../src/db";
import {
  users, customers, deals, vehicles, vehicleCheckIns, vehicleCheckInPhotos, dealVehicles,
} from "../src/db/schema";
import { getLotRows } from "../src/lib/lotQuery";
import { daysOnLot } from "../src/lib/lot";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);

// Five vehicles covering the cases the lot view has to get right.
const V = {
  sames:     "3GCUYDED9NG567890", // Sames, no deal, sitting 120 days — the headline case
  onDeal:    "1FTFW1E80PFA12345", // Chiefs, on a deal, 10 days
  inShop:    "1FM5K8AB4NGA98765", // Customer, in shop, 45 days
  departed:  "JH4KA7561PC111333", // left the lot — must be hidden by default
  noCheckIn: "WAUZZZ8V1JA111222", // added via /vehicles, never checked in
  returned:  "2FABP7BV0AX100004", // left once, came back 5 days ago
};
const ALL = Object.values(V);

async function main() {
  await db.delete(vehicles).where(inArray(vehicles.vin, ALL));
  const [user] = await db.insert(users)
    .values({ email: `lot-${Date.now()}@example.test`, name: "Verifier", role: "admin" })
    .returning();
  const [customer] = await db.insert(customers).values({ name: "Waller County SO" }).returning();
  const [deal] = await db.insert(deals).values({ customerId: customer.id, stage: "po_received" }).returning();

  const mk = async (vin: string, over: Record<string, unknown>) =>
    (await db.insert(vehicles).values({ vin, ...over } as never).returning())[0];

  const sames = await mk(V.sames, { year: 2022, make: "Chevrolet", model: "Silverado", ownership: "sames", lotStatus: "on_lot_available", lotLocation: "Front Display" });
  const onDeal = await mk(V.onDeal, { year: 2023, make: "Ford", model: "F-150", ownership: "chiefs", lotStatus: "on_lot_assigned", lotLocation: "Row A-3" });
  const inShop = await mk(V.inShop, { year: 2022, make: "Ford", model: "Explorer", ownership: "customer", lotStatus: "in_shop", lotLocation: "Bay 2" });
  const departed = await mk(V.departed, { year: 2021, make: "Dodge", model: "Durango", ownership: "chiefs", lotStatus: "departed" });
  const noCheckIn = await mk(V.noCheckIn, { year: 2020, make: "Ford", model: "Crown Vic", lotStatus: "on_lot_available" });
  const returned = await mk(V.returned, { year: 2019, make: "Chevrolet", model: "Tahoe", ownership: "sames", lotStatus: "on_lot_available" });

  const ci = async (vehicleId: string, arrived: Date, departedAt: Date | null = null) =>
    (await db.insert(vehicleCheckIns)
      .values({ vehicleId, arrivedAt: arrived, departedAt, checkedInBy: user.id })
      .returning())[0];

  const samesCi = await ci(sames.id, daysAgo(120));
  await ci(onDeal.id, daysAgo(10));
  await ci(inShop.id, daysAgo(45));
  await ci(departed.id, daysAgo(200), daysAgo(150));
  // Left once, came back — the two-table split's whole purpose.
  await ci(returned.id, daysAgo(400), daysAgo(300));
  await ci(returned.id, daysAgo(5));

  // A front photo plus a decoy in another slot, to prove the thumbnail picks
  // the right one.
  await db.insert(vehicleCheckInPhotos).values([
    { checkInId: samesCi.id, url: "https://x/rear.jpg", slot: "rear" },
    { checkInId: samesCi.id, url: "https://x/front.jpg", slot: "front" },
  ]);

  await db.insert(dealVehicles).values({ dealId: deal.id, vehicleId: onDeal.id, linkedBy: user.id });

  const mine = (rows: Awaited<ReturnType<typeof getLotRows>>) =>
    rows.filter((r) => ALL.includes(r.vin));

  // ---- 1. default view -----------------------------------------------------
  console.log("\ndefault view (on site)");
  const def = mine(await getLotRows());
  check("departed vehicles are hidden by default", !def.some((r) => r.vin === V.departed));
  check("a vehicle with no check-in still appears", def.some((r) => r.vin === V.noCheckIn));
  check("five on-site vehicles", def.length === 5, String(def.length));

  const order = def.map((r) => r.vin);
  check(
    "sorted by days on lot, DESCENDING — longest-sitting first",
    order[0] === V.sames && order[1] === V.inShop && order[2] === V.onDeal,
    order.map((v) => v.slice(-5)).join(" > "),
  );
  check("the vehicle with no arrival sorts LAST", order[order.length - 1] === V.noCheckIn, order[order.length - 1]);

  const samesRow = def.find((r) => r.vin === V.sames)!;
  check("days on lot is ~120", daysOnLot(samesRow.arrivedAt, samesRow.departedAt) === 120,
    String(daysOnLot(samesRow.arrivedAt, samesRow.departedAt)));
  check("front photo thumbnail resolved", samesRow.frontPhotoUrl === "https://x/front.jpg", String(samesRow.frontPhotoUrl));
  check("lot location resolved", samesRow.lotLocation === "Front Display", String(samesRow.lotLocation));
  check("no deal shows as null", samesRow.dealId === null);

  const noCi = def.find((r) => r.vin === V.noCheckIn)!;
  check("no check-in gives null days rather than 0",
    daysOnLot(noCi.arrivedAt, noCi.departedAt) === null);

  // ---- 2. a returned vehicle measures from its LATEST arrival -------------
  console.log("\nre-arrival");
  const ret = def.find((r) => r.vin === V.returned)!;
  check("uses the most recent check-in, not the first",
    daysOnLot(ret.arrivedAt, ret.departedAt) === 5,
    String(daysOnLot(ret.arrivedAt, ret.departedAt)));
  check("the old closed stay does not leak in", ret.departedAt === null);

  // ---- 3. deal join --------------------------------------------------------
  console.log("\ndeal");
  const onDealRow = def.find((r) => r.vin === V.onDeal)!;
  check("current deal resolved", onDealRow.dealId === deal.id);
  check("customer name came through", onDealRow.customerName === "Waller County SO", String(onDealRow.customerName));
  check("deal stage came through", onDealRow.dealStage === "po_received", String(onDealRow.dealStage));

  // ---- 4. filters ----------------------------------------------------------
  console.log("\nfilters");
  const samesOnly = mine(await getLotRows({ ownership: "sames" }));
  check("ownership filter", samesOnly.length === 2 && samesOnly.every((r) => r.ownership === "sames"), String(samesOnly.length));

  const unset = mine(await getLotRows({ ownership: "unset" }));
  check("unclassified filter finds the unowned one", unset.length === 1 && unset[0].vin === V.noCheckIn);

  const shop = mine(await getLotRows({ lotStatus: "in_shop" }));
  check("lot status filter", shop.length === 1 && shop[0].vin === V.inShop);

  const gone = mine(await getLotRows({ lotStatus: "departed" }));
  check("asking for departed shows them", gone.length === 1 && gone[0].vin === V.departed);
  check("a departed stay is frozen at its length",
    daysOnLot(gone[0].arrivedAt, gone[0].departedAt) === 50,
    String(daysOnLot(gone[0].arrivedAt, gone[0].departedAt)));

  const hasDeal = mine(await getLotRows({ deal: "has" }));
  check("has-deal filter", hasDeal.length === 1 && hasDeal[0].vin === V.onDeal);
  const noDeal = mine(await getLotRows({ deal: "none" }));
  check("no-deal filter excludes the one on a deal", noDeal.length === 4 && !noDeal.some((r) => r.vin === V.onDeal), String(noDeal.length));

  check("search by make is case-insensitive",
    mine(await getLotRows({ q: "chevrolet" })).length === 2);
  check("search by model works", mine(await getLotRows({ q: "Explorer" })).length === 1);
  check("search by partial VIN works", mine(await getLotRows({ q: "567890" })).length === 1);
  check("a search that matches nothing returns nothing", mine(await getLotRows({ q: "zzzznope" })).length === 0);

  const combined = mine(await getLotRows({ ownership: "sames", deal: "none", q: "Silverado" }));
  check("filters combine", combined.length === 1 && combined[0].vin === V.sames);

  // ---- 5. unlinking a deal removes it from the row ------------------------
  console.log("\nunlinked deal");
  await db.update(dealVehicles).set({ unlinkedAt: new Date(), unlinkedBy: user.id });
  const after = mine(await getLotRows());
  check("a closed link shows as no deal", after.find((r) => r.vin === V.onDeal)?.dealId === null);
  check("and the vehicle is still on the lot", after.some((r) => r.vin === V.onDeal));
  check("no row is duplicated by the link history", after.length === 5, String(after.length));

  // ---- 6. the inline status change is gated on the SERVER ----------------
  // The lot view hides the dropdown from a tech. That protects nothing on its
  // own — anyone can post the action directly. The decision is made from the
  // session, and this proves it.
  console.log("\ninline lot-status change");
  sessionUserId = user.id;
  const { setLotStatusAction } = await import("../src/app/lot/actions");

  sessionRole = "warehouse";
  const wh = await setLotStatusAction(sames.id, "in_shop");
  check("warehouse may move a vehicle", wh.ok, wh.ok ? "" : wh.error);
  check("and it was actually written",
    (await db.select().from(vehicles).where(eq(vehicles.id, sames.id)))[0].lotStatus === "in_shop");

  sessionRole = "tech";
  const tech = await setLotStatusAction(sames.id, "departed");
  check("tech is REFUSED even posting directly", !tech.ok, tech.ok ? "" : tech.error);
  check("and nothing changed",
    (await db.select().from(vehicles).where(eq(vehicles.id, sames.id)))[0].lotStatus === "in_shop");

  sessionRole = "admin";
  const bogus = await setLotStatusAction(sames.id, "on_fire");
  check("an invented status is rejected", !bogus.ok, bogus.ok ? "" : bogus.error);
  check("still unchanged",
    (await db.select().from(vehicles).where(eq(vehicles.id, sames.id)))[0].lotStatus === "in_shop");

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
