// Unit tests for the days-on-lot calculation. Runs standalone under tsx:
//
//   npx tsx src/lib/lot.test.ts
//
// Days-on-lot is the number the lot view exists for, and it cannot be
// backfilled — so it is worth being exact about.

import assert from "node:assert/strict";
import { daysOnLot, shortVin } from "./lot";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

console.log("lot — days on lot");

test("counts whole days since arrival for a vehicle still here", () => {
  assert.equal(daysOnLot(daysAgo(31), null, NOW), 31);
  assert.equal(daysOnLot(daysAgo(1), null, NOW), 1);
});

test("a vehicle that arrived today reads 0, not 1", () => {
  assert.equal(daysOnLot(daysAgo(0), null, NOW), 0);
  assert.equal(daysOnLot(new Date(NOW.getTime() - 3_600_000), null, NOW), 0);
});

test("part-days round DOWN — 6 days and 23 hours is still 6", () => {
  const arrived = new Date(NOW.getTime() - (6 * 86_400_000 + 23 * 3_600_000));
  assert.equal(daysOnLot(arrived, null, NOW), 6);
});

test("a departed vehicle reports the LENGTH OF ITS STAY, not time since", () => {
  // Arrived 100 days ago, left 40 days ago -> it was here for 60 days, and
  // that number must stop moving now that it has gone.
  assert.equal(daysOnLot(daysAgo(100), daysAgo(40), NOW), 60);
  const later = new Date(NOW.getTime() + 30 * 86_400_000);
  assert.equal(daysOnLot(daysAgo(100), daysAgo(40), later), 60, "must not keep climbing");
});

test("no check-in means null, not zero", () => {
  // A vehicle added through /vehicles has no arrival to measure from.
  // Showing "0 days" there would be a lie rather than a gap.
  assert.equal(daysOnLot(null, null, NOW), null);
  assert.equal(daysOnLot(undefined, undefined, NOW), null);
});

test("a future-dated arrival reads 0 rather than negative", () => {
  const future = new Date(NOW.getTime() + 86_400_000);
  assert.equal(daysOnLot(future, null, NOW), 0);
});

test("an invalid date does not produce NaN days", () => {
  assert.equal(daysOnLot(new Date("nonsense"), null, NOW), null);
});

test("a re-arrival is measured from the LATEST arrival", () => {
  // The lot view joins the most recent check-in, so this is really a
  // statement about what the query hands in: months away must not count.
  const firstStay = daysOnLot(daysAgo(400), daysAgo(300), NOW);
  const currentStay = daysOnLot(daysAgo(12), null, NOW);
  assert.equal(firstStay, 100);
  assert.equal(currentStay, 12);
});

console.log("\nlot — short VIN");

test("shows the last 8 characters, which is what is read off a windscreen", () => {
  assert.equal(shortVin("1FTFW1E80PFA12345"), "0PFA12345".slice(-8));
  assert.equal(shortVin("1FTFW1E80PFA12345"), "PFA12345");
});

test("a short or odd VIN is returned unchanged rather than mangled", () => {
  assert.equal(shortVin("ABC123"), "ABC123");
  assert.equal(shortVin(""), "");
});

console.log(`\n${passed} test(s) passed.`);
