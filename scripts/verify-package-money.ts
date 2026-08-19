// Money math checks for packages and quote lines. Pure functions only — no
// database, no browser. Run: npx tsx scripts/verify-package-money.ts
//
// The property that matters throughout: the per-line figures shown on screen
// must add up to the totals shown underneath them. Round-then-sum, never
// sum-then-round.
import { packageTotals, expandPackageWithBundlePrice } from "../src/lib/packages";
import { quoteTotals, lineGross, lineDiscount, lineNet } from "../src/lib/quoteTotals";
import { discountAmount, round2, parseMoney, moneyInputValue, fmtUSD } from "../src/lib/money";
import type { PackageComponent } from "../src/db/schema";

let fails = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

const item = (o: Partial<Extract<PackageComponent, { kind: "item" }>>): PackageComponent => ({
  kind: "item",
  description: o.description ?? "part",
  quantity: o.quantity ?? 1,
  unitPrice: o.unitPrice ?? 0,
  cost: o.cost ?? null,
  discount: o.discount ?? null,
  discountKind: o.discountKind ?? null,
  partId: o.partId ?? null,
  sku: o.sku ?? null,
});

console.log("\n1. formatting");
check("fmtUSD always shows two decimals and a $", fmtUSD(1250) === "$1,250.00", fmtUSD(1250));
check("fmtUSD rounds to the cent", fmtUSD(0.125) === "$0.13", fmtUSD(0.125));
check("parseMoney tolerates $ and commas", parseMoney("$1,234.50") === 1234.5);
check("parseMoney distinguishes cleared from zero", parseMoney("") === null && parseMoney("0") === 0);
check("moneyInputValue pads to 2dp", moneyInputValue(9.5) === "9.50", moneyInputValue(9.5));
check("round2 handles the classic float case", round2(1.005) === 1.01, String(round2(1.005)));

console.log("\n2. a discount never exceeds what is being discounted");
check("150% off is capped at the line value", discountAmount(100, 150, "pct") === 100);
check("a $500 discount on a $100 line caps at $100", discountAmount(100, 500, "amt") === 100);
check("negative discounts are ignored", discountAmount(100, -20, "amt") === 0);

console.log("\n3. bundle price and per-line discount BOTH apply");
// Promo: 2 lights at $1,000 list = $2,000, sold as a $1,500 bundle.
// Then 10% off one line, on top of the promo price.
const promo = [item({ description: "Light", quantity: 2, unitPrice: 1000, cost: 600 })];
const plain = packageTotals(promo, null);
check("no bundle, no discount → net is list", eq(plain.partsNet, 2000), String(plain.partsNet));

const bundled = packageTotals(promo, 1500);
check("bundle price alone → net is the bundle price", eq(bundled.partsNet, 1500), String(bundled.partsNet));
check("the reduction is reported as bundle, not line", eq(bundled.bundleDiscount, 500) && eq(bundled.lineDiscount, 0));

const both = packageTotals(
  [item({ description: "Light", quantity: 2, unitPrice: 1000, cost: 600, discount: 10, discountKind: "pct" })],
  1500,
);
check("10% comes off the PROMO price, not list", eq(both.lineDiscount, 150), `${both.lineDiscount} (expected 150 = 10% of 1500)`);
check("both reductions apply", eq(both.partsNet, 1350), String(both.partsNet));
check("neither overrides the other", eq(both.bundleDiscount, 500) && eq(both.lineDiscount, 150));

console.log("\n4. the same numbers survive the trip onto a quote");
const { lines } = expandPackageWithBundlePrice(
  [item({ description: "Light", quantity: 2, unitPrice: 1000, cost: 600, discount: 10, discountKind: "pct" })],
  1500,
);
const qt = quoteTotals(lines as never[], 0);
check("quote subtotal is list", eq(qt.subtotal, 2000), String(qt.subtotal));
check("quote discount total is bundle + line", eq(qt.discountTotal, 650), String(qt.discountTotal));
check("quote grand matches the package net", eq(qt.grand, 1350), String(qt.grand));
const l0 = lines[0];
check("the line row itself shows the same net", eq(lineNet(l0 as never), 1350), String(lineNet(l0 as never)));

console.log("\n5. rows foot to the total (round-then-sum)");
// Three lines at prices that do not divide evenly into the bundle.
const awkward = [
  item({ description: "A", quantity: 3, unitPrice: 33.33 }),
  item({ description: "B", quantity: 1, unitPrice: 0.01 }),
  item({ description: "C", quantity: 7, unitPrice: 19.99 }),
];
for (const target of [100, 99.99, 123.45, 1]) {
  const t = packageTotals(awkward, target);
  const exp = expandPackageWithBundlePrice(awkward, target);
  const sumRows = round2(exp.lines.reduce((s, l) => (l.kind === "item" ? round2(s + lineNet(l as never)) : s), 0));
  check(`bundle $${target}: rows sum to the bundle price`, eq(sumRows, target), `rows ${sumRows}`);
  check(`bundle $${target}: totals agree with the rows`, eq(t.partsNet, sumRows), `${t.partsNet} vs ${sumRows}`);
}

console.log("\n6. labor and fees are not swept into a parts bundle price");
const mixed: PackageComponent[] = [
  item({ description: "Part", quantity: 1, unitPrice: 500 }),
  { kind: "labor", description: "Install", hours: 2, rate: 95 },
  { kind: "fee", description: "Freight", amount: 40, fixed: true },
];
const m = packageTotals(mixed, 400);
check("parts discounted to the bundle", eq(m.partsNet, 400), String(m.partsNet));
check("labor untouched", eq(m.labor, 190), String(m.labor));
check("fees untouched", eq(m.fees, 40), String(m.fees));
check("total = parts net + labor + fees", eq(m.total, 630), String(m.total));

console.log("\n7. a bundle price above list is refused rather than inverted");
const tooHigh = expandPackageWithBundlePrice(promo, 5000);
check("allocation refuses and reports why", !tooHigh.allocated && !!tooHigh.error, tooHigh.error ?? "");
check("lines come back undiscounted, not negative", eq(lineGross(tooHigh.lines[0] as never), 2000) && lineDiscount(tooHigh.lines[0] as never) === 0);

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
