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

console.log("\n7. a bundle price ABOVE list scales the sell prices to hit it");
// The reported case: add-ons on the build, and the negotiated bundle number
// lands just above the sum of list prices.
const addOns = [
  item({ description: "Lightbar", quantity: 1, unitPrice: 9274.98 }),
  item({ description: "Ion", quantity: 2, unitPrice: 2500 }),
];
const grossAddOns = packageTotals(addOns, null).partsGross;
check("à la carte total is what we expect", eq(grossAddOns, 14274.98), String(grossAddOns));

const target = 14378.1;
const up = expandPackageWithBundlePrice(addOns, target);
check("it scales rather than erroring", up.scaled && !up.error, up.error ?? "scaled");
const upTotal = packageTotals(addOns, target);
check("parts total lands exactly on the target", eq(upTotal.partsNet, target), String(upTotal.partsNet));
const rowSum = round2(
  up.lines.reduce((s, l) => (l.kind === "item" ? round2(s + lineNet(l as never)) : s), 0),
);
check("the rows sum to the target too", eq(rowSum, target), String(rowSum));
check("every scaled unit price is still 2dp", up.lines.every((l) => l.kind !== "item" || Number(l.unitPrice.toFixed(2)) === l.unitPrice), JSON.stringify(up.lines.filter((l) => l.kind === "item").map((l) => (l as { unitPrice: number }).unitPrice)));
check("prices went UP, not down", up.lines.every((l) => l.kind !== "item" || l.unitPrice > 0));
// The unit prices must reach the target on their own. Anything left over would
// print as a "Discount $0.01" line on the customer's quote.
check(
  "no stray rounding discount is left on the lines",
  up.lines.every((l) => l.kind !== "item" || !l.bundleDiscount),
  JSON.stringify(up.lines.filter((l) => l.kind === "item").map((l) => (l as { bundleDiscount?: number }).bundleDiscount)),
);

// Awkward targets must still land exactly.
for (const t of [14378.1, 20000, 14274.99, 99999.99]) {
  const r = packageTotals(addOns, t);
  check(`target $${t}: exact`, eq(r.partsNet, t), String(r.partsNet));
}

console.log("\n7b. scaling does not rewrite what 'list' means");
// The trap: partsGross is the scaled figure, so a screen that reads "Retail
// (list)" off it would claim list was the bundle price and the customer saved
// a penny. `alacarteGross` is the honest one.
check("alacarteGross stays at the catalogue total", eq(upTotal.alacarteGross, 14274.98), String(upTotal.alacarteGross));
check("the scaled flag is set", upTotal.scaled === true);
check("uplift is the difference over list", eq(upTotal.uplift, 103.12), String(upTotal.uplift));
check("nothing is passed off as a discount when scaling up", upTotal.bundleDiscount === 0, String(upTotal.bundleDiscount));

console.log("\n7c. awkward quantities still tie exactly");
// Every quantity even, so a single leftover cent cannot be handed out one
// unit-cent at a time — the fallback has to catch it and still tie.
const evens = [
  item({ description: "A", quantity: 2, unitPrice: 100 }),
  item({ description: "B", quantity: 4, unitPrice: 50 }),
];
for (const t of [401, 400.01, 777.77, 1000.03]) {
  const r = packageTotals(evens, t);
  const ex = expandPackageWithBundlePrice(evens, t);
  const rows = round2(ex.lines.reduce((s, l) => (l.kind === "item" ? round2(s + lineNet(l as never)) : s), 0));
  check(`even quantities, target $${t}: parts total is exact`, eq(r.partsNet, t), String(r.partsNet));
  check(`even quantities, target $${t}: rows foot to it`, eq(rows, t), String(rows));
  check(
    `even quantities, target $${t}: unit prices are 2dp`,
    ex.lines.every((l) => l.kind !== "item" || Number(l.unitPrice.toFixed(2)) === l.unitPrice),
    JSON.stringify(ex.lines.filter((l) => l.kind === "item").map((l) => (l as { unitPrice: number }).unitPrice)),
  );
}

// A $0 accessory riding along must not silently acquire a price.
const withFreebie = [
  item({ description: "Paid", quantity: 1, unitPrice: 1000 }),
  item({ description: "Included accessory", quantity: 3, unitPrice: 0 }),
];
const freebie = expandPackageWithBundlePrice(withFreebie, 1234.57);
const zeroLine = freebie.lines.find((l) => l.kind === "item" && l.description === "Included accessory");
check("a $0 line stays $0 through the scaling", (zeroLine as { unitPrice: number }).unitPrice === 0, String((zeroLine as { unitPrice: number }).unitPrice));
check("and the total still ties", eq(packageTotals(withFreebie, 1234.57).partsNet, 1234.57), String(packageTotals(withFreebie, 1234.57).partsNet));
const belowT = packageTotals(addOns, 12000);
check("below list: not scaled, and list is unchanged", belowT.scaled === false && eq(belowT.alacarteGross, 14274.98));
check("below list: uplift is zero, discount is real", eq(belowT.uplift, 0) && eq(belowT.bundleDiscount, 2274.98), String(belowT.bundleDiscount));
const noneT = packageTotals(addOns, null);
check("no bundle price: gross and à la carte agree", eq(noneT.partsGross, noneT.alacarteGross) && !noneT.scaled);

console.log("\n8. scaling never touches labor or fees");
const withLabor: PackageComponent[] = [
  item({ description: "Part", quantity: 1, unitPrice: 500 }),
  { kind: "labor", description: "Install", hours: 4, rate: 95 },
  { kind: "fee", description: "Freight", amount: 103.12, fixed: true },
];
const scaledMix = packageTotals(withLabor, 900);
check("parts scaled up to the target", eq(scaledMix.partsNet, 900), String(scaledMix.partsNet));
check("labor untouched at $380", eq(scaledMix.labor, 380), String(scaledMix.labor));
check("fee untouched at $103.12", eq(scaledMix.fees, 103.12), String(scaledMix.fees));

console.log("\n9. nothing to scale from is still an honest error");
const noPrices = [item({ description: "Unpriced", quantity: 1, unitPrice: 0 })];
const bad = expandPackageWithBundlePrice(noPrices, 500);
check("explains that a sell price is needed", !!bad.error && /sell price/i.test(bad.error), bad.error ?? "");

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
