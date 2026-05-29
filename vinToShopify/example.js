// example.js
// -----------------------------------------------------------------------------
// A runnable demonstration of the module.
//
// Two ways to run it:
//
//   1. DRY RUN (free — no Shopify call, no credentials needed):
//        DRY_RUN=1 node example.js
//      This validates + decodes the VIN (NHTSA is free) and prints the exact
//      Shopify payload we WOULD send, without creating anything.
//
//   2. REAL RUN (creates a draft product in your store):
//        node --env-file=.env example.js
//      Node's built-in --env-file flag loads your .env (Node 18.20+/20.6+).
// -----------------------------------------------------------------------------

import { createCarListing, validateVin, decodeVin, buildProduct } from "./index.js";

// A real, well-known VIN (a Honda) so the NHTSA decode returns real data.
const sampleInput = {
  vin: "1HGCM82633A004352",
  price: 18995,
  condition: "Used - Excellent",
  mileage: 86230,
  photoUrls: [
    "https://example.com/photos/car-front.jpg",
    "https://example.com/photos/car-side.jpg",
  ],
  notes: "Clean title. Recent service. Two sets of keys.",
  // productType and status fall back to "Used Vehicle" / "draft".
};

async function main() {
  // -------------------------------------------------------------------------
  // DRY RUN: stop before the Shopify step and just show the payload.
  // -------------------------------------------------------------------------
  if (process.env.DRY_RUN) {
    console.log("DRY RUN — no product will be created.\n");

    const v = validateVin(sampleInput.vin);
    if (!v.ok) return console.error("Invalid VIN:", v.error);

    const decoded = await decodeVin(v.vin);
    if (!decoded.ok) return console.error("Decode failed:", decoded.error);

    const payload = buildProduct({
      decoded: decoded.data,
      vin: v.vin,
      listing: sampleInput,
    });

    console.log("Decoded vehicle:", decoded.data);
    console.log("\nShopify payload we WOULD send:\n");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // -------------------------------------------------------------------------
  // REAL RUN: full pipeline, including creating the product in Shopify.
  // -------------------------------------------------------------------------
  console.log("Creating car listing in Shopify...\n");
  const result = await createCarListing(sampleInput);

  if (result.status === "success") {
    console.log("Success!");
    console.log("  Product ID:   ", result.productId);
    console.log("  Title:        ", result.title);
    console.log("  Admin URL:    ", result.adminUrl);
    console.log("  Storefront:   ", result.storefrontUrl ?? "(draft — not public yet)");
  } else {
    // result.stage tells us WHICH step failed (validate/decode/build/shopify).
    console.error(`Failed at the "${result.stage}" stage:`);
    console.error("  " + result.error);
    process.exitCode = 1; // signal failure to the shell
  }
}

// main() is async, so it returns a Promise. We attach .catch() to make sure any
// truly unexpected error still prints instead of vanishing.
main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exitCode = 1;
});
