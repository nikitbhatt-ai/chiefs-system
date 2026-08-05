// Unit tests for the pure allocation engine. No test framework is configured in
// this repo, so this runs standalone under tsx:
//
//   npx tsx src/lib/promoAllocation.test.ts
//
// It asserts the engine's invariants and exits non-zero on any failure.

import assert from "node:assert/strict";
import { allocatePromo, PromoAllocationError } from "./promoAllocation";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const centsSum = (nums: number[]) => nums.reduce((a, b) => a + Math.round(b * 100), 0);

test("simple discount, qty 1 — ties exactly and applies the discount proportionally", () => {
  const r = allocatePromo({
    packagePrice: 90,
    lines: [
      { sku: "A", quantity: 1, alacarteCostSnap: 60 },
      { sku: "B", quantity: 1, alacarteCostSnap: 40 },
    ],
  });
  assert.equal(r.totalBasis, 100);
  assert.equal(r.effectivePackagePrice, 90);
  assert.equal(centsSum(r.lines.map((l) => l.allocatedExtended)), 9000); // ties to $90.00
  assert.equal(r.lines[0].allocatedUnitCost, 54);
  assert.equal(r.lines[1].allocatedUnitCost, 36);
  assert.equal(r.saving, 10);
  for (const l of r.lines) assert.ok(l.allocatedUnitCost <= l.alacarteCostSnap);
});

test("rounding plug — three equal lines that don't divide evenly still sum to package price", () => {
  const r = allocatePromo({
    packagePrice: 10,
    lines: [
      { sku: "A", quantity: 1, alacarteCostSnap: 10 },
      { sku: "B", quantity: 1, alacarteCostSnap: 10 },
      { sku: "C", quantity: 1, alacarteCostSnap: 10 },
    ],
  });
  assert.equal(centsSum(r.lines.map((l) => l.allocatedExtended)), 1000); // exactly $10.00
  // The plug lands the residual cent on the (first) largest line.
  const cents = r.lines.map((l) => Math.round(l.allocatedExtended * 100)).sort((a, b) => a - b);
  assert.deepEqual(cents, [333, 333, 334]);
});

test("freight folds into the package price before allocation", () => {
  const r = allocatePromo({
    packagePrice: 90,
    freight: 10,
    lines: [
      { sku: "A", quantity: 1, alacarteCostSnap: 60 },
      { sku: "B", quantity: 1, alacarteCostSnap: 40 },
    ],
  });
  assert.equal(r.effectivePackagePrice, 100);
  assert.equal(r.saving, 0);
  assert.equal(r.lines[0].allocatedUnitCost, 60); // boundary: allocated == à la carte is allowed
});

test("qty > 1 — extended totals still tie to the package price", () => {
  const r = allocatePromo({
    packagePrice: 200,
    lines: [
      { sku: "A", quantity: 2, alacarteCostSnap: 100 }, // basis 200
      { sku: "B", quantity: 1, alacarteCostSnap: 50 }, // basis 50
    ],
  });
  assert.equal(r.totalBasis, 250);
  assert.equal(centsSum(r.lines.map((l) => l.allocatedExtended)), 20000); // $200.00
  assert.equal(r.lines[0].allocatedUnitCost, 80);
  assert.equal(r.lines[1].allocatedUnitCost, 40);
  for (const l of r.lines) assert.ok(l.allocatedUnitCost <= l.alacarteCostSnap);
});

test("refuses a package priced above its à la carte basket", () => {
  assert.throws(
    () =>
      allocatePromo({
        packagePrice: 120,
        lines: [
          { sku: "A", quantity: 1, alacarteCostSnap: 60 },
          { sku: "B", quantity: 1, alacarteCostSnap: 40 },
        ],
      }),
    PromoAllocationError,
  );
});

test("deterministic — same input yields identical output", () => {
  const input = {
    packagePrice: 6840,
    lines: [
      { sku: "TCRWX6", quantity: 1, alacarteCostSnap: 1282.8 },
      { sku: "XI3JC", quantity: 4, alacarteCostSnap: 112 },
      { sku: "REST", quantity: 1, alacarteCostSnap: 7699.2 },
    ],
  };
  assert.deepEqual(allocatePromo(input), allocatePromo(input));
});

test("F-150 shape — $9,430 basis, $6,840 package ties exactly with a ~$2,590 saving", () => {
  // Not the exact 17-line sheet (deliberately not fabricated — see Phase 1), but
  // the same headline numbers: basis $9,430, package $6,840, saving $2,590.
  const r = allocatePromo({
    packagePrice: 6840,
    lines: [
      { sku: "TCRWX6", quantity: 1, alacarteCostSnap: 1282.8 },
      { sku: "XI3JC", quantity: 4, alacarteCostSnap: 112 }, // basis 448.00
      { sku: "BALANCE", quantity: 1, alacarteCostSnap: 7699.2 },
    ],
  });
  assert.equal(r.totalBasis, 9430);
  assert.equal(centsSum(r.lines.map((l) => l.allocatedExtended)), 684000); // exactly $6,840.00
  assert.equal(r.saving, 2590);
  for (const l of r.lines) assert.ok(l.allocatedUnitCost <= l.alacarteCostSnap, `${l.sku} over à la carte`);
});

console.log(`\nAll ${passed} allocation tests passed.`);
