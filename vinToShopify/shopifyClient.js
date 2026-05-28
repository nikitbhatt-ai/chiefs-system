// shopifyClient.js
// -----------------------------------------------------------------------------
// The only file that talks to Shopify. It reads credentials from environment
// variables (never hardcoded) and exposes one job: create a product.
//
// AUTH MODEL (important context):
// Dev Dashboard apps don't hand out a static long-lived admin token. Instead,
// you keep your app's Client ID and Client Secret, and exchange them for a
// short-lived access token (valid ~24h) via the client_credentials OAuth grant.
// That access token is what goes in the X-Shopify-Access-Token header.
//
// We do the exchange once per process and cache the token in memory until it's
// about to expire, so a single run that creates many products only logs in
// once.
// -----------------------------------------------------------------------------

// Shopify Admin REST API version, per the spec. Bumping this is a one-line change.
const API_VERSION = "2024-10";

// In-memory cache for the access token (per process). Lost when the script exits.
let cachedToken = null;
let cachedTokenExpiresAt = 0; // epoch ms; we'll refresh a minute early to be safe

/**
 * Read and validate the required environment variables.
 *
 * We do this lazily (inside the function, not at import time) so that simply
 * importing the module — e.g. to unit-test buildProduct — never throws just
 * because env vars aren't set.
 */
function readConfig() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!domain || !clientId || !clientSecret) {
    return {
      ok: false,
      error:
        "Missing Shopify credentials. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET in your environment.",
    };
  }

  // Tolerate the domain being given with or without the https:// prefix.
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return { ok: true, domain: cleanDomain, clientId, clientSecret };
}

/**
 * Exchange the app's Client ID + Secret for a short-lived Admin API token using
 * Shopify's client_credentials OAuth grant. Caches the token in memory so we
 * don't re-auth on every product create.
 *
 * @returns {Promise<{ ok: boolean, token?: string, error?: string }>}
 */
async function getAccessToken(domain, clientId, clientSecret) {
  // Use the cached token if it's still good for at least another 60 seconds.
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) {
    return { ok: true, token: cachedToken };
  }

  const url = `https://${domain}/admin/oauth/access_token`;
  // The token endpoint expects form-urlencoded, not JSON.
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "vinToShopify/1.0",
      },
      body,
    });
  } catch (networkError) {
    return {
      ok: false,
      error: `Could not reach Shopify auth endpoint: ${networkError.message}`,
    };
  }

  const rawBody = await response.text();

  if (!response.ok) {
    // Common failure: "shop_not_permitted" means the app isn't installed on
    // this store, or the app and store aren't in the same Dev Dashboard org.
    return {
      ok: false,
      error: `Shopify auth failed (HTTP ${response.status}): ${rawBody}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: `Shopify auth returned non-JSON: ${rawBody}` };
  }

  if (!parsed.access_token) {
    return { ok: false, error: `Shopify auth returned no access_token: ${rawBody}` };
  }

  cachedToken = parsed.access_token;
  // expires_in is in seconds (typically 86399 = 24h). Convert to epoch ms.
  const expiresInMs = (parsed.expires_in ?? 3600) * 1000;
  cachedTokenExpiresAt = Date.now() + expiresInMs;
  return { ok: true, token: cachedToken };
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

  const { domain, clientId, clientSecret } = config;

  // Step A: get a fresh (or cached) Admin API access token.
  const auth = await getAccessToken(domain, clientId, clientSecret);
  if (!auth.ok) return auth;

  // Step B: use that token to create the product.
  const url = `https://${domain}/admin/api/${API_VERSION}/products.json`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "vinToShopify/1.0",
        "X-Shopify-Access-Token": auth.token,
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
