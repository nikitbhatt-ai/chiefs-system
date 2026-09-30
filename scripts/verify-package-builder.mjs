// Browser checks for the package builder changes. Throwaway database only —
// it creates packages and edits them.
//
// Playwright is NOT a project dependency; install it where you run this.
// Run against a PRODUCTION build:
//   npm run build && npx next start -p 3100
//   BASE=http://localhost:3100 node scripts/verify-package-builder.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3100";
const EMAIL = process.env.EMAIL ?? "v@chiefspursuitsurplus.com";
const PASSWORD = process.env.PASSWORD ?? "Verify123!";

let fails = 0;
const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
page.on("pageerror", (e) => console.log("  PAGEERROR:", e.message.slice(0, 140)));

await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith("/signin")).catch(() => {}),
  page.click('button:has-text("Sign in")'),
]);
await page.waitForTimeout(1200);

// Create a package to build in.
await page.goto(`${BASE}/packages`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
const pkgName = `Regional + add-ons ${Date.now()}`;
await page.fill('input[name="name"]', pkgName);
await page.click('button:has-text("Create & build")');
await page.waitForURL(/\/packages\/.+\/edit/, { timeout: 20000 });
await page.waitForTimeout(1200);
console.log("editing:", page.url());

// ── 1. Add controls at BOTH ends ────────────────────────────────────────────
console.log("\n1. add controls at top and bottom");
const partAdders = await page.locator('input[placeholder*="Search inventory"]').count();
const pkgAdders = await page.locator('input[placeholder*="Add package"]').count();
check("part search appears twice", partAdders === 2, `${partAdders}`);
check("package/promo adder appears twice", pkgAdders === 2, `${pkgAdders}`);

// ── 2. Pull the promo in — flat lines, source untouched ────────────────────
console.log("\n2. pull the Whelen promo into this package");
const promoBefore = await (await page.request.get(`${BASE}/api/packages/search?q=Whelen`)).json();
const srcBefore = JSON.stringify(promoBefore[0]?.components ?? []);
const srcPriceBefore = promoBefore[0]?.packagePrice;

await page.locator('input[placeholder*="Add package"]').first().click();
await page.locator('input[placeholder*="Add package"]').first().fill("Whelen");
await page.waitForTimeout(900);
await page.keyboard.press("Enter");
await page.waitForTimeout(800);

const rowsAfterPromo = await page.locator('input[aria-label="Sell price per unit"]').count();
check("promo came in as individual part lines", rowsAfterPromo === 2, `${rowsAfterPromo} part rows`);
check("a note says the original is untouched", (await page.getByText("original is untouched").count()) > 0);

// ── 3. Costs are locked from the promo, not re-derived ─────────────────────
const costs = await page.locator('input[aria-label="Internal cost per unit"]').evaluateAll((els) => els.map((e) => e.value));
check("promo costs carried over (840.00 / 195.00)", costs.includes("840.00") && costs.includes("195.00"), JSON.stringify(costs));

// ── 4. The promo's deal survived as per-line discounts ─────────────────────
const bodyText = await page.locator("body").innerText();
const netMatch = bodyText.match(/Customer pays \(parts\)\s*\$([\d,]+\.\d{2})/);
check("parts net equals the promo price ($1,700.00)", netMatch?.[1] === "1,700.00", netMatch?.[1] ?? "not found");

// ── 5. Add-ons on top ──────────────────────────────────────────────────────
console.log("\n3. add 2 Ions on top");
await page.locator('input[placeholder*="Search inventory"]').first().click();
await page.locator('input[placeholder*="Search inventory"]').first().fill("ION-J");
await page.waitForTimeout(900);
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
const qtyBoxes = page.locator('input[aria-label="Quantity"]');
await qtyBoxes.last().fill("2");
await page.waitForTimeout(300);

const costsNow = await page.locator('input[aria-label="Internal cost per unit"]').evaluateAll((els) => els.map((e) => e.value));
check("the Ion line uses AVG cost 61.25, not cost 55.00", costsNow.includes("61.25"), JSON.stringify(costsNow));

// ── 6. Enter opens a new line ──────────────────────────────────────────────
console.log("\n4. Enter commits and opens a new line");
const before = await page.locator('input[aria-label="Quantity"]').count();
await qtyBoxes.last().press("Enter");
await page.waitForTimeout(400);
const after = await page.locator('input[aria-label="Quantity"]').count();
check("Enter added a line", after === before + 1, `${before} → ${after}`);
check("Enter did not submit the form", page.url().includes("/edit"), page.url());

// ── 7. Money formatting ────────────────────────────────────────────────────
console.log("\n5. currency formatting");
const sells = await page.locator('input[aria-label="Sell price per unit"]').evaluateAll((els) => els.map((e) => e.value));
check("every sell price shows 2 decimals", sells.every((v) => v === "" || /^\d+\.\d{2}$/.test(v)), JSON.stringify(sells));
const dollarSigns = await page.locator("text=/^\\$$/").count();
check("money boxes carry a $ adornment", dollarSigns >= 4, `${dollarSigns} adornments`);
const qty = await page.locator('input[aria-label="Quantity"]').first().inputValue();
check("quantities are NOT dollar-formatted", /^\d+$/.test(qty), qty);

// ── 8. Save, and confirm the source promo is unchanged ─────────────────────
console.log("\n6. save; the source promo must be untouched");
await page.locator('button:has-text("Save package")').first().click();
await page.waitForTimeout(2500);
const promoAfter = await (await page.request.get(`${BASE}/api/packages/search?q=Whelen`)).json();
check("source promo components unchanged", JSON.stringify(promoAfter[0]?.components ?? []) === srcBefore);
check("source promo bundle price unchanged", promoAfter[0]?.packagePrice === srcPriceBefore, `${srcPriceBefore} → ${promoAfter[0]?.packagePrice}`);

const mine = (await (await page.request.get(`${BASE}/api/packages/search?q=${encodeURIComponent("Regional + add-ons")}`)).json())[0];
const items = (mine?.components ?? []).filter((c) => c.kind === "item");
check("the new package saved its lines", items.length >= 3, `${items.length} item lines`);
check("saved lines kept their locked costs", items.some((c) => Number(c.cost) === 840), JSON.stringify(items.map((c) => c.cost)));
check("saved lines kept their discounts", items.some((c) => Number(c.discount) > 0), JSON.stringify(items.map((c) => c.discount)));

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
