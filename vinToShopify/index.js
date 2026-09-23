// index.js
// -----------------------------------------------------------------------------
// The public entry point. This is the orchestrator: it wires the small,
// single-purpose modules together into one pipeline and is the only thing
// callers need to import.
//
//   validateVin  ->  decodeVin  ->  buildProduct  ->  createProduct
//
// Each step returns a { ok, ... } object. If any step fails, we stop and return
// that step's error immediately ("fail fast"), so a caller always gets back a
// single, consistent shape: either a success result or an error result.
// -----------------------------------------------------------------------------

import { validateVin } from "./validate.js";
import { decodeVin } from "./decodeVin.js";
import { buildProduct } from "./buildProduct.js";
import { createProduct } from "./shopifyClient.js";

/**
 * Create a Shopify car listing from a VIN plus listing details.
 *
 * @param {object} input
 * @param {string} input.vin                 - 17-char VIN (required)
 * @param {number|string} input.price        - listing price (required)
 * @param {string} [input.condition]         - e.g. "Used - Excellent"
 * @param {number} [input.mileage]           - odometer reading in miles
 * @param {string[]} [input.photoUrls]       - public image URLs
 * @param {string} [input.notes]             - free-text notes for the listing
 * @param {string} [input.productType]       - defaults to "Used Vehicle"
 * @param {string} [input.status]            - "draft" (default) or "active"
 * @param {string|number} [input.year]       - override / fallback for NHTSA
 * @param {string} [input.make]              - override / fallback for NHTSA
 * @param {string} [input.model]             - override / fallback for NHTSA
 * @param {string} [input.trim]              - override / fallback for NHTSA
 * @returns {Promise<object>} success or error result (see shapes below)
 *
 * Success: { status: "success", productId, adminUrl, storefrontUrl, title, decoded }
 * Error:   { status: "error", stage, error }   // `stage` shows where it failed
 *
 * This is `async` because it `await`s the two network steps (decode + create).
 * Calling it looks like:  const result = await createCarListing({ ... });
 */
export async function createCarListing(input = {}) {
  // ---- Step 0: basic input presence -----------------------------------------
  if (input.price == null) {
    return { status: "error", stage: "input", error: "A price is required." };
  }

  // ---- Step 1: validate the VIN (no network) --------------------------------
  const validation = validateVin(input.vin);
  if (!validation.ok) {
    return { status: "error", stage: "validate", error: validation.error };
  }
  const vin = validation.vin; // the cleaned/uppercased VIN

  // ---- Step 2: get vehicle specs ------------------------------------------
  // If the caller already knows year+make+model (the ERP does — it stored
  // them the first time the VIN was decoded), skip NHTSA entirely and use
  // that data. NHTSA's check-digit validation rejects some real VINs
  // (ErrorCode 1) and blocking a publish over that would be silly when we
  // already have what we need. If those fields aren't provided, fall back
  // to the NHTSA decode as before; and if NHTSA fails but we have any
  // year/make/model at all, use that instead of hard-erroring.
  let decoded;
  const hasCallerSpecs = input.year && input.make && input.model;
  if (hasCallerSpecs) {
    decoded = callerSpecsToDecoded(input);
  } else {
    const decode = await decodeVin(vin);
    if (decode.ok) {
      decoded = decode.data;
    } else if (input.year || input.make || input.model) {
      decoded = callerSpecsToDecoded(input);
    } else {
      return { status: "error", stage: "decode", error: decode.error };
    }
  }

  // ---- Step 3: build the Shopify payload (pure, in-memory) ------------------
  let payload;
  try {
    payload = buildProduct({ decoded, vin, listing: input });
  } catch (buildError) {
    // Defensive: building is pure and shouldn't throw, but if a weird input
    // slips through we still return a clean error instead of crashing.
    return { status: "error", stage: "build", error: buildError.message };
  }

  // ---- Step 4 & 5: create the product in Shopify (network) ------------------
  // Inventory is set to 1 here via the variant's inventory_quantity in the
  // payload — Shopify applies it at the store's default location on create.
  const created = await createProduct(payload);
  if (!created.ok) {
    return { status: "error", stage: "shopify", error: created.error };
  }

  // ---- Step 6: success — return the useful bits -----------------------------
  return {
    status: "success",
    productId: created.productId,
    adminUrl: created.adminUrl,
    storefrontUrl: created.storefrontUrl,
    title: payload.product.title,
    decoded,
  };
}

function callerSpecsToDecoded(input) {
  return {
    ModelYear: input.year != null ? String(input.year) : "",
    Make: input.make ?? "",
    Model: input.model ?? "",
    Trim: input.trim ?? "",
  };
}

// Also export the building blocks so they can be imported and tested directly.
export { validateVin, decodeVin, buildProduct, createProduct };
