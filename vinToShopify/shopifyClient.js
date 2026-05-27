// shopifyClient.js
// -----------------------------------------------------------------------------
// The only file that talks to Shopify. It reads credentials from environment
// variables (never hardcoded) and exposes one job: create a product.
//
// Isolating all Shopify-specific knowledge here means the rest of the module
// doesn't care *how* products get created — it just calls createProduct() and
// gets back a normalized { ok, ... } result. If Shopify changes its API, this
// is the only file we touch.
// -----------------------------------------------------------------------------

// Shopify Admin REST API version, per the spec. Bumping this is a one-line change.
const API_VERSION = "2024-10";

/**
 * Read and validate the two required environment variables.
 *
 * We do this lazily (inside the function, not at import time) so that simply
 * importing the module — e.g. to unit-test buildProduct — never throws just
 * because env vars aren't set.
 */
function readConfig() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain || !token) {
    return {
      ok: false,
      error:
        "Missing Shopify credentials. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN in your environment.",
    };
  }

  // Tolerate the domain being given with or without the https:// prefix.
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return { ok: true, domain: cleanDomain, token };
}

/**
 * Create a product in Shopify.
 *
 * `async` again because this makes a network request. The caller `await`s the
 * returned Promise to get the final result.
 *
 * @param {object} productPayload - the { product: {...} } object from buildProduct
 * @returns {Promise<{ ok: boolean, product?: object, productId?: number,
 *                      adminUrl?: string, storefrontUrl?: string, error?: string }>}
 */
export async function createProduct(productPayload) {
  const config = readConfig();
  if (!config.ok) return config; // bubble the "missing credentials" error up

  const { domain, token } = config;
  const url = `https://${domain}/admin/api/${API_VERSION}/products.json`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "vinToShopify/1.0",
        // Shopify's private-app/admin auth header.
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify(productPayload),
    });
  } catch (networkError) {
    return {
      ok: false,
      error: `Could not reach Shopify (network error): ${networkError.message}`,
    };
  }

  // Read the body once, as text, so we can show useful error detail even when
  // the response isn't valid JSON (e.g. an HTML error page).
  const rawBody = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      error: `Shopify API error (HTTP ${response.status}): ${rawBody}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      error: `Shopify returned a non-JSON success response: ${rawBody}`,
    };
  }

  const product = parsed.product;
  if (!product || !product.id) {
    return {
      ok: false,
      error: "Shopify response did not include a created product id.",
    };
  }

  // Build handy links back to the new product.
  // - adminUrl: where staff edit the product (works for draft products too).
  // - storefrontUrl: the public page (only live once the product is published).
  const adminUrl = `https://${domain}/admin/products/${product.id}`;
  const storefrontUrl = product.handle
    ? `https://${domain}/products/${product.handle}`
    : undefined;

  return {
    ok: true,
    product,
    productId: product.id,
    adminUrl,
    storefrontUrl,
  };
}
