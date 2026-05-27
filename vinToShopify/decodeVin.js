// decodeVin.js
// -----------------------------------------------------------------------------
// Talks to the free NHTSA vPIC API to turn a 17-character VIN into a tidy object
// of the vehicle attributes we actually care about.
//
// The raw API returns ~130 "variables" in a flat array, most of which we don't
// need. This file's job is to (a) make the request, (b) confirm the VIN decoded
// successfully, and (c) hand back a small, predictable object. Everything that
// knows about NHTSA's quirks lives here and nowhere else.
// -----------------------------------------------------------------------------

// The vPIC "DecodeVin" endpoint. {VIN} gets swapped in below.
const NHTSA_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin";

// The exact variable names (as NHTSA spells them) that we want to pull out of
// the big Results array. Keeping this list in one place makes it easy to add or
// remove fields later.
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

  // The data we need lives under payload.Results — an array of
  // { Variable, Value } objects. Bail out if it's missing or empty.
  const results = payload?.Results;
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, error: "NHTSA API response was empty or malformed." };
  }

  // Flatten the array into a simple { Make: "Honda", Model: "Civic", ... } map,
  // keeping only the fields we listed above.
  const data = {};
  for (const item of results) {
    if (FIELDS_WE_WANT.includes(item.Variable)) {
      // NHTSA uses empty strings (or null) for unknown fields; normalize to "".
      data[item.Variable] = item.Value ?? "";
    }
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
