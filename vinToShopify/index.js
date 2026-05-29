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

  // ---- Step 2: decode the VIN via NHTSA (network) ---------------------------
  const decode = await decodeVin(vin);
  if (!decode.ok) {
    return { status: "error", stage: "decode", error: decode.error };
  }

  // ---- Step 3: build the Shopify payload (pure, in-memory) ------------------
  let payload;
  try {
    payload = buildProduct({ decoded: decode.data, vin, listing: input });
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
    decoded: decode.data, // handy for logging/auditing what NHTSA returned
  };
}

// Also export the building blocks so they can be imported and tested directly.
export { validateVin, decodeVin, buildProduct, createProduct };
