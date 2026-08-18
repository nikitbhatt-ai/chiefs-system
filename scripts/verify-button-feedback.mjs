// Scratch verification for button feedback. Not part of the app.
//
// The thing being tested is perception, not implementation: after a click, is
// there something on screen, for long enough to see? An earlier version of this
// script asserted internals (does the button carry data-pending) and passed
// while the feature was, in practice, invisible — the button was correct and
// then destroyed by a re-render 80ms later. So the central check here samples
// the whole PAGE every animation frame and asks how many milliseconds ANY
// feedback was visible.
//
// Playwright is NOT a dependency of this project — install it where you run this
// (`npm i -D playwright && npx playwright install chromium`) rather than adding a
// browser download to everyone's install.
//
// Run against a THROWAWAY database, ideally a PRODUCTION build (`npm run build
// && npx next start -p 3100`), because dev-mode timings are not the ones users
// get:
//   BASE=http://localhost:3100 EMAIL=... PASSWORD=... node scripts/verify-button-feedback.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3100";
const EMAIL = process.env.EMAIL ?? "v@chiefspursuitsurplus.com";
const PASSWORD = process.env.PASSWORD ?? "Verify123!";

/** Below this, feedback is a flicker. Measured failures were 16–130ms. */
const PERCEPTIBLE_MS = 450;

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

/**
 * Watch the whole page for feedback of any kind — the work bar, or any element
 * marked busy — for `ms`, sampling every frame. Deliberately page-wide: the
 * button that started the work is often gone before the work finishes.
 */
async function watchPage(ms = 3000) {
  await page.evaluate(() => {
    window.__w = [];
    const tick = () => {
      window.__w.push({
        t: performance.now(),
        visible: !!document.querySelector(".work-indicator, [data-pending]"),
      });
      if (window.__w.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return async () => {
    await page.waitForTimeout(ms);
    const w = await page.evaluate(() => window.__w);
    const on = w.filter((x) => x.visible);
    return { ms: on.length ? Math.round(on[on.length - 1].t - on[0].t) : 0, frames: on.length };
  };
}

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
check("held button scales down", held.transform.includes("0.94"), held.transform);
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

// ── 3. In-place save: visible, and honest about it ──────────────────────────
console.log("\n3. in-place save — /accounting/accounts");
const api = async () => (await (await page.request.get(`${BASE}/api/accounting/accounts`)).json());
// Text codes, so use one that cannot collide with the real chart — a numeric
// probe hit 3900 Retained Earnings and the insert failed, which looked like a
// missing flash rather than a duplicate key.
const code = `ZZ-PROBE-${Date.now()}`;
const before = (await api()).length;
await page.fill('input[name="code"]', code);
await page.fill('input[name="name"]', "Feedback probe");
let stop = await watchPage(3000);
await page.locator('button:has-text("Save account")').first().click();

// Poll for the completion flash, then ask the database immediately: the flash
// must not claim success before the row exists.
let flashAt = null;
for (let i = 0; i < 120; i++) {
  const seen = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Save account"));
    return el ? el.hasAttribute("data-saved") : false;
  });
  if (seen) { flashAt = i * 25; break; }
  await page.waitForTimeout(25);
}
const rows = await api();
check("feedback visible long enough to see", (await stop()).ms >= PERCEPTIBLE_MS);
check("completion flash fires", flashAt !== null, `${flashAt}ms`);
check("flash only claims success once the row exists", rows.some((r) => r.code === code));
check("saved exactly once (no double submit)", rows.length === before + 1, `${before} -> ${rows.length}`);

// ── 4. The button gets destroyed by its own refresh ─────────────────────────
console.log("\n4. list row action — the button is removed by router.refresh()");
await page.goto(`${BASE}/packages`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1300);
if (await page.locator('button:has-text("Archive")').first().count()) {
  stop = await watchPage(3000);
  await page.locator('button:has-text("Archive")').first().click();
  const r = await stop();
  check("feedback survives the row being replaced", r.ms >= PERCEPTIBLE_MS, `${r.ms}ms`);
} else {
  console.log("  skip  no archivable row in this data set");
}

// ── 5. Redirecting save ────────────────────────────────────────────────────
console.log("\n5. redirecting save — the whole page is replaced");
await page.goto(`${BASE}/packages`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1300);
await page.fill('input[name="name"]', `Feedback probe ${Date.now()}`);
stop = await watchPage(3000);
await page.locator('button:has-text("Create & build")').first().click();
const redirected = await stop();
check("feedback survives the navigation", redirected.ms >= PERCEPTIBLE_MS, `${redirected.ms}ms`);

// ── 6. Nothing gets stuck ──────────────────────────────────────────────────
console.log("\n6. nothing left stuck");
await page.waitForTimeout(2500);
check("work bar is gone once idle", !(await page.evaluate(() => !!document.querySelector(".work-indicator"))));
const stuck = await page.evaluate(() =>
  [...document.querySelectorAll("button")].filter((b) => b.disabled).map((b) => b.textContent.trim().slice(0, 20)),
);
check("no button left disabled", stuck.length === 0, JSON.stringify(stuck));

// ── 7. One form, several submit buttons ────────────────────────────────────
// useFormStatus reports the FORM's status, so the trap is every button spinning
// at once and implying the wrong action is running.
console.log("\n7. one form, several submit buttons");
await page.route("**/settings/sla", async (route) => {
  if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 2000));
  await route.continue();
});
await page.goto(`${BASE}/settings/sla`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1400);
const form = page.locator('form:has(button:has-text("Reset to default"))').first();
if ((await form.count()) === 0) {
  console.log("  skip  no multi-button form in this data set (needs a stored SLA override)");
} else {
  await form.locator('button:has-text("Reset to default")').click();
  await page.waitForTimeout(300);
  const buttons = await form.evaluate((f) =>
    [...f.querySelectorAll("button")].map((el) => ({
      label: el.textContent.trim().slice(0, 20),
      spinner: getComputedStyle(el, "::after").animationName === "btn-spin",
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
