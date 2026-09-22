// Unit tests for check-in draft persistence. No test framework is configured
// in this repo, so this runs standalone under tsx:
//
//   npx tsx src/lib/checkInDraft.test.ts
//
// localStorage is faked, including the ways a real one misbehaves: private
// mode, blocked site data, and a full quota.

import assert from "node:assert/strict";

type Store = { data: Map<string, string>; throwOnSet: boolean; throwOnGet: boolean };

const store: Store = { data: new Map(), throwOnSet: false, throwOnGet: false };

// Installed BEFORE importing the module, because it checks `typeof window`.
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem(k: string) {
      if (store.throwOnGet) throw new Error("SecurityError: storage is blocked");
      return store.data.has(k) ? store.data.get(k)! : null;
    },
    setItem(k: string, v: string) {
      if (store.throwOnSet) throw new Error("QuotaExceededError");
      store.data.set(k, v);
    },
    removeItem(k: string) {
      store.data.delete(k);
    },
  },
};

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function reset() {
  store.data.clear();
  store.throwOnSet = false;
  store.throwOnGet = false;
}

async function main() {
  const {
    saveDraft,
    loadDraft,
    clearDraft,
    isDraftWorthOffering,
    describeAge,
  } = await import("./checkInDraft");

  const VIN_A = "1FTFW1E80PFA12345";
  const VIN_B = "3GCUYDED9NG567890";

  const draft = (vin: string, over: Record<string, unknown> = {}) => ({
    vin,
    fields: { odometer: "412", lotLocation: "Row A-3" },
    chips: ["Curb rash"],
    damageText: "front passenger wheel",
    fuel: "three_quarter",
    photos: [{ url: "https://x/front.jpg", slot: "front", key: "front" }],
    savedAt: Date.now(),
    ...over,
  });

  console.log("checkInDraft");

  test("saves and loads a draft round-trip", () => {
    reset();
    saveDraft(draft(VIN_A));
    const got = loadDraft(VIN_A);
    assert.equal(got?.fields.odometer, "412");
    assert.deepEqual(got?.chips, ["Curb rash"]);
    assert.equal(got?.fuel, "three_quarter");
    assert.equal(got?.photos.length, 1);
  });

  test("drafts are keyed by VIN and do not collide", () => {
    reset();
    saveDraft(draft(VIN_A, { damageText: "vehicle A" }));
    saveDraft(draft(VIN_B, { damageText: "vehicle B" }));
    assert.equal(loadDraft(VIN_A)?.damageText, "vehicle A");
    assert.equal(loadDraft(VIN_B)?.damageText, "vehicle B");
  });

  test("a VIN is matched however it was typed", () => {
    reset();
    saveDraft(draft(VIN_A));
    assert.ok(loadDraft(` ${VIN_A.toLowerCase()} `), "lowercase and padded should find it");
  });

  test("clearDraft removes only that VIN", () => {
    reset();
    saveDraft(draft(VIN_A));
    saveDraft(draft(VIN_B));
    clearDraft(VIN_A);
    assert.equal(loadDraft(VIN_A), null);
    assert.ok(loadDraft(VIN_B), "the other vehicle's draft must survive");
  });

  test("an unknown VIN loads as null, not a crash", () => {
    reset();
    assert.equal(loadDraft(VIN_A), null);
    assert.equal(loadDraft(""), null);
  });

  test("a full quota does not throw — a draft is a convenience", () => {
    reset();
    store.throwOnSet = true;
    assert.doesNotThrow(() => saveDraft(draft(VIN_A)));
    store.throwOnSet = false;
    assert.equal(loadDraft(VIN_A), null, "nothing was stored, and that is fine");
  });

  test("blocked storage reads as null rather than throwing", () => {
    reset();
    saveDraft(draft(VIN_A));
    store.throwOnGet = true;
    assert.doesNotThrow(() => loadDraft(VIN_A));
    assert.equal(loadDraft(VIN_A), null);
  });

  test("corrupt JSON loads as null", () => {
    reset();
    store.data.set(`chiefs:checkin-draft:${VIN_A}`, "{not json");
    assert.equal(loadDraft(VIN_A), null);
  });

  test("a hand-edited draft is sanitised, not trusted", () => {
    reset();
    store.data.set(
      `chiefs:checkin-draft:${VIN_A}`,
      JSON.stringify({
        vin: VIN_A,
        fields: "not-an-object",
        chips: ["ok", 42, null],
        damageText: 99,
        fuel: null,
        photos: [{ url: "https://x/a.jpg", slot: "front", key: "k" }, { nope: true }, null],
        savedAt: "yesterday",
      }),
    );
    const got = loadDraft(VIN_A);
    assert.deepEqual(got?.fields, {}, "a non-object fields map becomes empty");
    assert.deepEqual(got?.chips, ["ok"], "non-string chips are dropped");
    assert.equal(got?.damageText, "", "a non-string note becomes empty");
    assert.equal(got?.fuel, "");
    assert.equal(got?.photos.length, 1, "malformed photos are dropped");
    assert.equal(got?.savedAt, 0);
  });

  test("an empty draft is not worth offering", () => {
    assert.equal(isDraftWorthOffering(null), false);
    assert.equal(
      isDraftWorthOffering({
        vin: VIN_A, fields: {}, chips: [], damageText: "", fuel: "", photos: [], savedAt: 1,
      }),
      false,
    );
    assert.equal(
      isDraftWorthOffering({
        vin: VIN_A, fields: { vin: VIN_A, make: "  " }, chips: [], damageText: "  ",
        fuel: "", photos: [], savedAt: 1,
      }),
      false,
      "a VIN alone, or whitespace, is not unfinished work",
    );
  });

  test("a draft with any real content IS worth offering", () => {
    const base = { vin: VIN_A, fields: {}, chips: [], damageText: "", fuel: "", photos: [], savedAt: 1 };
    assert.equal(isDraftWorthOffering({ ...base, photos: [{ url: "https://x", slot: null, key: "k" }] }), true);
    assert.equal(isDraftWorthOffering({ ...base, chips: ["Dent"] }), true);
    assert.equal(isDraftWorthOffering({ ...base, damageText: "scraped" }), true);
    assert.equal(isDraftWorthOffering({ ...base, fuel: "half" }), true);
    assert.equal(isDraftWorthOffering({ ...base, fields: { odometer: "412" } }), true);
  });

  test("the photos field is never persisted twice", () => {
    // The form carries a hidden `photos` input; it is stored as a real array,
    // not also as a JSON string inside `fields`.
    reset();
    saveDraft(draft(VIN_A, { fields: { odometer: "10" } }));
    assert.equal(loadDraft(VIN_A)?.fields.photos, undefined);
  });

  test("describeAge reads like a person would say it", () => {
    const now = Date.now();
    assert.equal(describeAge(now - 5_000, now), "just now");
    assert.equal(describeAge(now - 60_000, now), "1 minute ago");
    assert.equal(describeAge(now - 180_000, now), "3 minutes ago");
    assert.equal(describeAge(now - 3_600_000, now), "1 hour ago");
    assert.equal(describeAge(now - 86_400_000, now), "1 day ago");
  });

  console.log(`\n${passed} test(s) passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
