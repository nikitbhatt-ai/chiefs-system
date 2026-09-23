// Unit tests for the pure PO fee math. No test framework is configured in this
// repo, so this runs standalone under tsx:
//
//   npx tsx src/lib/poFees.test.ts
//
// It asserts the invariants that matter for money: freight allocation ties to
// the entered freight exactly, only receivable lines are charged, and the
// freight/other split is respected. Exits non-zero on any failure.

import assert from "node:assert/strict";
import {
  FIXED_FREIGHT_LABEL,
  allocateFreight,
  feeTotals,
  landedUnitCost,
  pruneFees,
  withFixedFreight,
} from "./poFees";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const sum = (nums: number[]) => nums.reduce((a, b) => a + b, 0);

// ── feeTotals ────────────────────────────────────────────────────────────────

test("feeTotals splits freight from other and sums in cents", () => {
  const t = feeTotals([
    { kind: "freight", amount: 125.5 },
    { kind: "other", amount: 10 },
    { kind: "freight", amount: 4.5 },
  ]);
  assert.equal(t.freightCents, 13000); // 125.50 + 4.50
  assert.equal(t.otherCents, 1000);
  assert.equal(t.totalCents, 14000);
});

test("feeTotals ignores blank, zero and negative rows, and treats unknown kinds as other", () => {
  const t = feeTotals([
    { kind: "freight", amount: 0 },
    { kind: "other", amount: -5 },
    { kind: "handling", amount: 7 }, // unknown kind → other
    {},
  ]);
  assert.equal(t.freightCents, 0);
  assert.equal(t.otherCents, 700);
  assert.equal(t.totalCents, 700);
});

test("feeTotals tolerates null/undefined", () => {
  assert.equal(feeTotals(null).totalCents, 0);
  assert.equal(feeTotals(undefined).totalCents, 0);
  assert.equal(feeTotals([]).totalCents, 0);
});

// ── allocateFreight ──────────────────────────────────────────────────────────

test("freight spreads in proportion to extended value and ties exactly", () => {
  const lines = [
    { partId: "a", quantity: 1, unitCost: 60 },
    { partId: "b", quantity: 1, unitCost: 40 },
  ];
  const alloc = allocateFreight(lines, 1000); // $10.00 freight
  assert.deepEqual(alloc, [600, 400]);
  assert.equal(sum(alloc), 1000);
});

test("extended value uses quantity, not just unit cost", () => {
  const lines = [
    { partId: "a", quantity: 10, unitCost: 10 }, // basis 10000
    { partId: "b", quantity: 1, unitCost: 10 }, //  basis  1000
  ];
  const alloc = allocateFreight(lines, 1100);
  assert.deepEqual(alloc, [1000, 100]);
  assert.equal(sum(alloc), 1100);
});

test("rounding plug — three equal lines that don't divide evenly still tie", () => {
  const lines = [
    { partId: "a", quantity: 1, unitCost: 1 },
    { partId: "b", quantity: 1, unitCost: 1 },
    { partId: "c", quantity: 1, unitCost: 1 },
  ];
  const alloc = allocateFreight(lines, 1000); // 10.00 / 3
  assert.equal(sum(alloc), 1000, "allocation must tie to the entered freight");
  for (const c of alloc) assert.ok(c >= 333 && c <= 334);
});

test("lines with no linked part get nothing — freight only rides receivable lines", () => {
  const lines = [
    { partId: "a", quantity: 1, unitCost: 50 },
    { quantity: 1, unitCost: 50 }, // free-text line, never becomes a layer
  ];
  const alloc = allocateFreight(lines, 900);
  assert.deepEqual(alloc, [900, 0]);
  assert.equal(sum(alloc), 900);
});

test("zero-quantity lines get nothing", () => {
  const lines = [
    { partId: "a", quantity: 0, unitCost: 50 },
    { partId: "b", quantity: 2, unitCost: 50 },
  ];
  const alloc = allocateFreight(lines, 500);
  assert.deepEqual(alloc, [0, 500]);
});

test("zero-value basket falls back to allocating by quantity", () => {
  const lines = [
    { partId: "a", quantity: 3, unitCost: 0 },
    { partId: "b", quantity: 1, unitCost: 0 },
  ];
  const alloc = allocateFreight(lines, 800);
  assert.deepEqual(alloc, [600, 200]);
  assert.equal(sum(alloc), 800);
});

test("no eligible lines — freight is not stranded on unreceivable lines", () => {
  const alloc = allocateFreight([{ quantity: 1, unitCost: 10 }], 500);
  assert.deepEqual(alloc, [0]);
});

test("no freight, empty lines, and non-positive freight are all no-ops", () => {
  assert.deepEqual(allocateFreight([{ partId: "a", quantity: 1, unitCost: 1 }], 0), [0]);
  assert.deepEqual(allocateFreight([{ partId: "a", quantity: 1, unitCost: 1 }], -100), [0]);
  assert.deepEqual(allocateFreight([], 500), []);
});

// ── landedUnitCost ───────────────────────────────────────────────────────────

test("landed unit cost folds per-unit freight into the unit cost", () => {
  assert.equal(landedUnitCost(10, 2, 400), 12); // $10 + ($4.00 / 2)
  assert.equal(landedUnitCost(10, 1, 250), 12.5);
});

test("landed unit cost rounds per-unit freight to the cent", () => {
  // $1.00 freight over 3 units → 33.333c each, rounds to 33c.
  assert.equal(landedUnitCost(5, 3, 100), 5.33);
});

test("landed unit cost with no freight is the unit cost unchanged", () => {
  assert.equal(landedUnitCost(19.99, 4, 0), 19.99);
});

test("landed unit cost with zero quantity degrades to the unit cost", () => {
  assert.equal(landedUnitCost(19.99, 0, 500), 19.99);
});

// ── end-to-end shape ─────────────────────────────────────────────────────────

test("allocation + landed cost — a realistic shipping charge lands in part cost", () => {
  const fees = [{ kind: "freight", amount: 45 }, { kind: "other", amount: 15 }];
  const { freightCents, otherCents } = feeTotals(fees);
  assert.equal(freightCents, 4500);
  assert.equal(otherCents, 1500); // expensed, never reaches a layer

  const lines = [
    { partId: "a", quantity: 3, unitCost: 100 }, // basis 30000
    { partId: "b", quantity: 2, unitCost: 75 }, //  basis 15000
  ];
  const alloc = allocateFreight(lines, freightCents);
  assert.equal(sum(alloc), 4500);
  assert.deepEqual(alloc, [3000, 1500]);
  assert.equal(landedUnitCost(100, 3, alloc[0]), 110); // $100 + $30/3
  assert.equal(landedUnitCost(75, 2, alloc[1]), 82.5); // $75 + $15/2
});

// ── withFixedFreight / pruneFees ─────────────────────────────────────────────

test("withFixedFreight synthesizes the standing row when a PO has none", () => {
  const out = withFixedFreight([{ description: "Handling", amount: 15, kind: "other" }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].fixed, true);
  assert.equal(out[0].kind, "freight");
  assert.equal(out[0].amount, 0);
  assert.equal(out[0].description, FIXED_FREIGHT_LABEL);
  assert.equal(out[1].description, "Handling");
});

test("withFixedFreight keeps the existing fixed row and hoists it to the front", () => {
  const out = withFixedFreight([
    { description: "Handling", amount: 15, kind: "other" },
    { description: FIXED_FREIGHT_LABEL, amount: 40, kind: "freight", fixed: true },
  ]);
  assert.equal(out.length, 2, "must not add a second fixed row");
  assert.equal(out[0].fixed, true);
  assert.equal(out[0].amount, 40, "the entered freight amount survives");
  assert.equal(out[1].description, "Handling");
});

test("withFixedFreight on an empty/null list still yields exactly the fixed row", () => {
  for (const input of [[], null, undefined]) {
    const out = withFixedFreight(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].fixed, true);
  }
});

test("the synthesized fixed row is an ordinary freight fee to the rest of the pipeline", () => {
  // It must flow through feeTotals as freight with no special-casing.
  const fees = withFixedFreight([]).map((f) => ({ ...f, amount: 30 }));
  assert.equal(feeTotals(fees).freightCents, 3000);
  assert.equal(feeTotals(fees).otherCents, 0);
});

test("pruneFees drops a zero fixed row and blank custom rows, keeps the rest", () => {
  const out = pruneFees([
    { description: FIXED_FREIGHT_LABEL, amount: 0, kind: "freight", fixed: true },
    { description: "", amount: 0, kind: "other" },
    { description: "Handling", amount: 15, kind: "other" },
    { description: "Noted but unpriced", amount: 0, kind: "other" },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((f) => f.description),
    ["Handling", "Noted but unpriced"],
  );
});

test("pruneFees keeps a fixed row that carries an amount", () => {
  const out = pruneFees([{ description: FIXED_FREIGHT_LABEL, amount: 40, kind: "freight", fixed: true }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 40);
});

test("withFixedFreight after pruneFees round-trips — a zeroed row comes back", () => {
  const saved = pruneFees(withFixedFreight([]));
  assert.deepEqual(saved, [], "nothing stored when freight is untouched");
  assert.equal(withFixedFreight(saved).length, 1, "editor still shows the row");
});

console.log(`\n${passed} tests passed.`);
