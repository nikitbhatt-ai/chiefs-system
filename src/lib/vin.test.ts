// Unit tests for VIN validation and decoding. No test framework is configured
// in this repo, so this runs standalone under tsx:
//
//   npx tsx src/lib/vin.test.ts
//
// No database and no network: the decoder tests stub global.fetch. The
// database half of lookupVin is covered by scripts/verify-vin-lookup.ts.

import assert from "node:assert/strict";
import { vinSchema, normalizeVin, decodeVin } from "./vin";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A real-shaped VIN used throughout.
const GOOD = "1FTFW1E80PFA12345";

const realFetch = global.fetch;
function stubFetch(impl: typeof global.fetch) {
  global.fetch = impl;
}
function restoreFetch() {
  global.fetch = realFetch;
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

async function main() {
  console.log("vin — validation");

  await test("accepts a well-formed VIN", () => {
    const r = vinSchema.safeParse(GOOD);
    assert.equal(r.success, true);
    assert.equal(r.success && r.data, GOOD);
  });

  await test("normalizes case and surrounding whitespace before validating", () => {
    const r = vinSchema.safeParse("  1ftfw1e80pfa12345\n");
    assert.equal(r.success, true, "a lowercase, padded VIN should still pass");
    assert.equal(r.success && r.data, GOOD, "and come back uppercased and trimmed");
  });

  await test("rejects a VIN that is not exactly 17 characters", () => {
    for (const bad of ["", "1FTFW1E80PFA1234", "1FTFW1E80PFA123456"]) {
      const r = vinSchema.safeParse(bad);
      assert.equal(r.success, false, `${bad || "(empty)"} should be rejected`);
      assert.match(r.success ? "" : r.error.issues[0].message, /exactly 17/);
    }
  });

  await test("rejects the letters I, O and Q", () => {
    // These were excluded from the VIN alphabet to avoid confusion with 1 and 0,
    // so their presence means a typo, not an exotic vehicle.
    for (const letter of ["I", "O", "Q"]) {
      const bad = letter + GOOD.slice(1);
      const r = vinSchema.safeParse(bad);
      assert.equal(r.success, false, `${letter} should be rejected`);
      assert.match(r.success ? "" : r.error.issues[0].message, /I, O or Q/);
    }
  });

  await test("rejects punctuation and spaces inside the VIN", () => {
    for (const bad of ["1FTFW1E80PFA1234-", "1FTFW1E8 PFA12345", "1FTFW1E80PFA1234!"]) {
      assert.equal(vinSchema.safeParse(bad).success, false, `${bad} should be rejected`);
    }
  });

  await test("normalizeVin trims and uppercases without validating", () => {
    assert.equal(normalizeVin("  abc123  "), "ABC123");
  });

  console.log("\nvin — decoding");

  await test("maps a vPIC payload onto our shape", async () => {
    stubFetch(async () =>
      jsonResponse({
        Results: [
          {
            ModelYear: "2023",
            Make: "FORD",
            Model: "F-150",
            Trim: "Police Responder",
            BodyClass: "Pickup",
            FuelTypePrimary: "Gasoline",
          },
        ],
      }),
    );
    const r = await decodeVin(GOOD);
    restoreFetch();
    assert.equal(r.ok, true);
    assert.ok(r.ok);
    assert.equal(r.data.year, 2023, "year is coerced to a number");
    assert.equal(r.data.make, "FORD");
    assert.equal(r.data.model, "F-150");
    assert.equal(r.data.trim, "Police Responder");
    assert.equal(r.data.vin, GOOD);
  });

  await test("blank vPIC fields come back as null, not empty strings", async () => {
    // vPIC returns "" for anything it cannot determine. A form pre-filled with
    // "" looks filled in; null lets the field stay genuinely empty.
    stubFetch(async () =>
      jsonResponse({ Results: [{ ModelYear: "", Make: "", Model: "  ", Trim: "" }] }),
    );
    const r = await decodeVin(GOOD);
    restoreFetch();
    assert.ok(r.ok);
    assert.equal(r.data.year, null);
    assert.equal(r.data.make, null);
    assert.equal(r.data.model, null);
    assert.equal(r.data.trim, null);
  });

  await test("an HTTP error from vPIC is a failure, not a throw", async () => {
    stubFetch(async () => jsonResponse({}, { status: 503 }));
    const r = await decodeVin(GOOD);
    restoreFetch();
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /503/);
  });

  await test("a network outage is a failure, not a throw", async () => {
    stubFetch(async () => {
      throw new Error("getaddrinfo ENOTFOUND vpic.nhtsa.dot.gov");
    });
    const r = await decodeVin(GOOD);
    restoreFetch();
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /network error/);
  });

  await test("a timeout is a failure, not a hang", async () => {
    stubFetch(async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    });
    const r = await decodeVin(GOOD);
    restoreFetch();
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /timed out/);
  });

  await test("an unreadable body is a failure, not a throw", async () => {
    stubFetch(async () => new Response("<html>gateway</html>", { status: 200 }));
    const r = await decodeVin(GOOD);
    restoreFetch();
    assert.equal(r.ok, false);
  });

  await test("an empty Results array is a failure, not a half-decoded vehicle", async () => {
    stubFetch(async () => jsonResponse({ Results: [] }));
    const r = await decodeVin(GOOD);
    restoreFetch();
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /no results/);
  });

  console.log(`\n${passed} test(s) passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
