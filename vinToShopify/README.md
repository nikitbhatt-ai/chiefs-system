# vinToShopify

Decode a VIN with the free [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/)
and create a car listing in your Shopify store via the Admin REST API.

```
vinToShopify/
  index.js          main export: createCarListing(input)
  validate.js       VIN validation (17 chars, no I/O/Q)
  decodeVin.js      NHTSA vPIC call + parsing
  buildProduct.js   decoded data -> Shopify product payload (pure function)
  shopifyClient.js  the only file that talks to Shopify
  example.js        runnable demo (dry-run + real-run)
  .env.example      template for required env vars
```

## Why it's split into files

Each file has one job, so each can be read, changed, and tested on its own:

- **validate / buildProduct** are *pure* (no network) — instant, free to test.
- **decodeVin / shopifyClient** are the only files doing network I/O, so all the
  "what if the API fails" handling lives in just two places.
- **index.js** is the orchestrator: it chains the steps and returns one
  consistent result shape.

## Requirements

- Node.js 18+ (uses the built-in `fetch` — no extra dependencies).

## Install

No npm packages are required. Just make sure you're on Node 18+:

```bash
node --version
```

(If you ever want to support older Node, `npm install node-fetch` and add
`import fetch from "node-fetch";` to `decodeVin.js` and `shopifyClient.js`.)

## Set up your `.env`

```bash
cp .env.example .env
```

Then edit `.env`:

```
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxx
```

Get the token from **Shopify admin → Settings → Apps and sales channels →
Develop apps → (your app) → API credentials**. Give it the `write_products`
Admin API scope.

## Usage

```js
import { createCarListing } from "./vinToShopify/index.js";

const result = await createCarListing({
  vin: "1HGCM82633A004352",
  price: 18995,
  condition: "Used - Excellent",
  mileage: 86230,
  photoUrls: ["https://.../front.jpg", "https://.../side.jpg"],
  notes: "Clean title. Recent service.",
  productType: "Used Vehicle", // optional, this is the default
  status: "draft",             // optional, "draft" is the default
});

if (result.status === "success") {
  console.log(result.productId, result.adminUrl);
} else {
  console.error(result.stage, result.error);
}
```

### Result shapes

```js
// success
{ status: "success", productId, adminUrl, storefrontUrl, title, decoded }

// error — `stage` is one of: input | validate | decode | build | shopify
{ status: "error", stage, error }
```

## Run the example

**Dry run (free, no Shopify call, no credentials):**

```bash
DRY_RUN=1 node vinToShopify/example.js
```

This validates + decodes the VIN and prints the Shopify payload it *would* send.

**Real run (creates a draft product):**

```bash
node --env-file=vinToShopify/.env vinToShopify/example.js
```

Created products are **draft** by default, so nothing goes live until you review
and publish it in the Shopify admin.

## Testing without spending real API calls

- The dry run above exercises everything except the Shopify POST, for free.
- `validate.js` and `buildProduct.js` are pure functions — import them in a test
  and assert on the returned objects; no network or mocking needed.
- To test `shopifyClient.js` without a live store, point it at a fake server or
  stub global `fetch` in your test runner.

## What to add next

1. **Update existing listings** — look up a product by SKU (the VIN) and `PATCH`
   it instead of always creating a new one.
2. **Local photo uploads** — accept file paths, upload bytes to Shopify (or your
   CDN) first, then pass the resulting URLs into the payload.
3. **Explicit inventory at a location** — for multi-location stores, use the
   InventoryLevels API instead of relying on create-time `inventory_quantity`.
4. **"Sold" webhooks** — subscribe to `orders/create` so a sold car is
   automatically marked unavailable / archived.
5. **Move to the GraphQL Admin API** — REST is on a deprecation path long-term;
   GraphQL is the strategic direction for Shopify.
