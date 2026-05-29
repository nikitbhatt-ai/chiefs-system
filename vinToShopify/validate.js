// validate.js
// -----------------------------------------------------------------------------
// A tiny, dependency-free helper that checks whether a string looks like a real
// VIN (Vehicle Identification Number) *before* we waste a network call on it.
//
// Why a separate file? Validation is a single, pure responsibility: give it a
// string, get back a verdict. Keeping it isolated means we can unit-test it on
// its own (no network, no Shopify) and reuse it anywhere.
//
// VIN rules we enforce:
//   1. Exactly 17 characters.
//   2. The letters I, O, and Q are never used in a real VIN — they were banned
//      to avoid confusion with the digits 1 and 0. Their presence means the VIN
//      is malformed (or someone typo'd).
//   3. Only letters A-Z and digits 0-9 are allowed (no spaces, dashes, etc.).
// -----------------------------------------------------------------------------

// Characters that are legal in a VIN: all digits, plus A-Z EXCEPT I, O, Q.
const VALID_VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * Check a VIN and return a structured result.
 *
 * We return an object (instead of throwing) so the caller can decide what to do
 * and so the same { ok, error } shape flows through the rest of the module.
 *
 * @param {string} vin - the raw VIN to validate
 * @returns {{ ok: boolean, vin?: string, error?: string }}
 */
export function validateVin(vin) {
  // Guard against non-strings (undefined, numbers, null) up front.
  if (typeof vin !== "string") {
    return { ok: false, error: "VIN must be a string." };
  }

  // VINs are conventionally uppercase; normalize so "abc..." still works,
  // and trim stray whitespace a user might paste in.
  const normalized = vin.trim().toUpperCase();

  if (normalized.length !== 17) {
    return {
      ok: false,
      error: `VIN must be exactly 17 characters (got ${normalized.length}).`,
    };
  }

  if (!VALID_VIN_PATTERN.test(normalized)) {
    return {
      ok: false,
      error:
        "VIN contains invalid characters. Only A-Z (excluding I, O, Q) and 0-9 are allowed.",
    };
  }

  // Passed every check — hand back the cleaned-up VIN for downstream use.
  return { ok: true, vin: normalized };
}
