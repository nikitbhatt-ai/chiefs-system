// Scratch verification for button feedback. Not part of the app.
//
// Checks the three signals a button has to give — press, working, done — in a
// real browser, because "the button feels dead" is not something a type check or
// a unit test can see.
//
// Playwright is NOT a dependency of this project — install it where you run this
// (`npm i -D playwright && npx playwright install chromium`) rather than adding a
// browser download to everyone's install.
//
// Run against a THROWAWAY database with the dev server up:
//   POSTGRES_URL=... npx next dev -p 3100
//   BASE=http://localhost:3100 EMAIL=... PASSWORD=... node scripts/verify-button-feedback.mjs
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
const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();

await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith("/signin")).catch(() => {}),
  page.click('button:has-text("Sign in")'),
]);
await page.waitForTimeout(1500);

// ── 1. Press ────────────────────────────────────────────────────────────────
console.log("\n1. press feedback");
await page.goto(`${BASE}/accounting/accounts`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const btn = page.locator('button:has-text("Save account")').first();
const box = await btn.boundingBox();

check("idle button is not transformed", (await btn.evaluate((el) => getComputedStyle(el).transform)) === "none");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(150);
const held = await btn.evaluate((el) => ({
  transform: getComputedStyle(el).transform,
  filter: getComputedStyle(el).filter,
  cursor: getComputedStyle(el).cursor,
}));
await page.mouse.up();
await page.waitForTimeout(300);
check("held button scales down", held.transform.includes("0.97"), held.transform);
check("held button darkens", held.filter.includes("brightness"), held.filter);
check("cursor is a pointer", held.cursor === "pointer");
check("returns to normal on release", (await btn.evaluate((el) => getComputedStyle(el).transform)) === "none");

// Colour fades must survive the unlayered transition override.
const tp = await btn.evaluate((el) => getComputedStyle(el).transitionProperty);
check(
  "press transform AND colour fades both transition",
  ["transform", "background-color", "color"].every((k) => tp.includes(k)),
  tp,
);

console.log("\n2. keyboard focus");
await btn.focus();
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Tab");
const outline = await btn.evaluate((el) => `${getComputedStyle(el).outlineWidth} ${getComputedStyle(el).outlineStyle}`);
check("focused button has a visible outline", outline.startsWith("2px solid"), outline);

// ── 3. Working + done ───────────────────────────────────────────────────────
// A server action on localhost finishes in ~50ms, far too fast to observe. The
// delay only holds the in-flight state still long enough to measure; the state
// itself is the real one.
console.log("\n3. working + done, during a real server action");
await page.route("**/accounting/accounts", async (route) => {
  if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 2500));
  await route.continue();
});
await page.goto(`${BASE}/accounting/accounts`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

const countAccounts = async () => (await (await page.request.get(`${BASE}/api/accounting/accounts`)).json()).length;
const before = await countAccounts();

await page.fill('input[name="code"]', `9${Math.floor(Math.random() * 900 + 100)}`);
await page.fill('input[name="name"]', "Feedback probe");
const save = page.locator('button:has-text("Save account")').first();
await save.click();
await page.waitForTimeout(700);

const working = await save.evaluate((el) => ({
  disabled: el.disabled,
  pending: el.hasAttribute("data-pending"),
  ariaBusy: el.getAttribute("aria-busy"),
  cursor: getComputedStyle(el).cursor,
  spinner: !!el.querySelector(".btn-spinner"),
  spin: el.querySelector(".btn-spinner") && getComputedStyle(el.querySelector(".btn-spinner")).animationName,
}));
check("disables while the action runs", working.disabled);
check("data-pending is set", working.pending);
check("aria-busy announced", working.ariaBusy === "true");
check("cursor becomes wait", working.cursor === "wait");
check("spinner rendered and animating", working.spinner && working.spin === "btn-spin", String(working.spin));

await save.click({ force: true }).catch(() => {}); // must not double-submit

await page
  .waitForFunction(
    () => {
      const el = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Save account"));
      return el && !el.hasAttribute("data-pending");
    },
    null,
    { timeout: 15000 },
  )
  .catch(() => {});
await page.waitForTimeout(150);

const done = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Save account"));
  return el && { flash: el.hasAttribute("data-saved"), anim: getComputedStyle(el).animationName, disabled: el.disabled };
});
check("completion flash fires", done?.flash === true);
check("flash animation runs", done?.anim === "btn-saved", String(done?.anim));
check("button is usable again", done?.disabled === false);
check("the record actually saved once", (await countAccounts()) === before + 1);

// ── 4. One form, several submit buttons ─────────────────────────────────────
// useFormStatus reports the FORM's status, so the trap is every button spinning
// at once and implying the wrong action is running.
console.log("\n4. one form, several submit buttons");
await page.route("**/settings/sla", async (route) => {
  if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 2500));
  await route.continue();
});
await page.goto(`${BASE}/settings/sla`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1400);
const form = page.locator('form:has(button:has-text("Reset to default"))').first();
if ((await form.count()) === 0) {
  console.log("  skip  no multi-button form on this data set (needs a stored SLA override)");
} else {
  await form.locator('button:has-text("Reset to default")').click();
  await page.waitForTimeout(600);
  const buttons = await form.evaluate((f) =>
    [...f.querySelectorAll("button")].map((el) => ({
      label: el.textContent.trim().slice(0, 20),
      spinner: !!el.querySelector(".btn-spinner"),
      disabled: el.disabled,
    })),
  );
  const spinning = buttons.filter((b) => b.spinner);
  check("only the pressed button spins", spinning.length === 1 && spinning[0].label.startsWith("Reset"), JSON.stringify(spinning));
  check("every button disables (no double-submit)", buttons.every((b) => b.disabled));
}

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
