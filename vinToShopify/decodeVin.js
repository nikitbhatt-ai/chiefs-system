// decodeVin.js
// -----------------------------------------------------------------------------
// Talks to the free NHTSA vPIC API to turn a 17-character VIN into a tidy object
// of the vehicle attributes we actually care about.
//
// We use the "DecodeVinValues" endpoint specifically (not "DecodeVin"). Both
// decode the same VIN, but the response shapes differ:
//   - DecodeVin       -> Results is an array of ~130 { Variable, Value } items
//                        where Variable names have spaces ("Model Year").
//   - DecodeVinValues -> Results is a one-element array whose single object is
//                        already flat, with no-space keys ("ModelYear",
//                        "BodyClass", "ErrorCode"). Much simpler to parse, and
//                        matches the field names listed in our spec.
// -----------------------------------------------------------------------------

// The vPIC "DecodeVinValues" endpoint. {VIN} gets swapped in below.
const NHTSA_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

// The fields we want to keep from the flat result object. Anything not in this
// list is dropped so downstream code only sees what it actually uses.
const FIELDS_WE_WANT = [
  "Make",
  "Model",
  "ModelYear",
  "Trim",
  "BodyClass",
  "EngineCylinders",
  "DisplacementL",
  "FuelTypePrimary",
  "TransmissionStyle",
  "DriveType",
  "VehicleType",
  "Manufacturer",
  "PlantCountry",
  "ErrorCode",
];

/**
 * Decode a VIN into a clean object of vehicle specs.
 *
 * Note the `async` keyword: this function does I/O (a network request), which
 * takes time. `async` lets us write `await fetch(...)` and read the code top-to-
 * bottom as if it were synchronous, while Node keeps doing other work in the
 * background until the response arrives. An async function always returns a
 * Promise, so callers must `await` it (or use .then()).
 *
 * @param {string} vin - a VIN that has ALREADY passed validateVin()
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
export async function decodeVin(vin) {
  const url = `${NHTSA_URL}/${encodeURIComponent(vin)}?format=json`;

  let response;
  try {
    // `await` pauses here until the HTTP request resolves. If the network is
    // down or the host is unreachable, fetch() rejects and we land in catch.
    // A User-Agent is sent because some hosts reject header-less requests (403).
    response = await fetch(url, {
      headers: { "User-Agent": "vinToShopify/1.0 (+https://chiefspursuitsurplus.com)" },
    });
  } catch (networkError) {
    return {
      ok: false,
      error: `Could not reach the NHTSA API (network error): ${networkError.message}`,
    };
  }

  // A 200-level status means the server answered happily. Anything else (500,
  // 404, etc.) is an API-side failure we should surface clearly.
  if (!response.ok) {
    return {
      ok: false,
      error: `NHTSA API returned HTTP ${response.status} (${response.statusText}).`,
    };
  }

  let payload;
  try {
    // Parsing the body is also async (the bytes may still be streaming in).
    payload = await response.json();
  } catch (parseError) {
    return {
      ok: false,
      error: `NHTSA API returned a response we couldn't parse as JSON: ${parseError.message}`,
    };
  }

  // DecodeVinValues returns Results as a one-element array; the single item is
  // already a flat object of { ModelYear: "...", Make: "...", ... }.
  const flat = payload?.Results?.[0];
  if (!flat || typeof flat !== "object") {
    return { ok: false, error: "NHTSA API response was empty or malformed." };
  }

  // Copy across only the fields we care about, normalizing empty/null to "".
  const data = {};
  for (const field of FIELDS_WE_WANT) {
    data[field] = flat[field] ?? "";
  }

  // ErrorCode "0" (or a comma-list starting with "0", e.g. "0,1,...") means the
  // VIN decoded successfully. Anything else means NHTSA couldn't make sense of
  // it, so we treat the VIN as invalid.
  const errorCode = String(data.ErrorCode ?? "");
  const decodedCleanly = errorCode === "0" || errorCode.startsWith("0,");
  if (!decodedCleanly) {
    return {
      ok: false,
      error: `NHTSA could not decode this VIN (ErrorCode: ${errorCode || "unknown"}).`,
    };
  }

  // Sanity check: even with ErrorCode 0, a totally bogus VIN can come back with
  // no Make/Model. Without at least those two we can't build a useful listing.
  if (!data.Make || !data.Model) {
    return {
      ok: false,
      error: "VIN decoded but returned no Make/Model — cannot build a listing.",
    };
  }

  return { ok: true, data };
}
