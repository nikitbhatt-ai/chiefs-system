// buildProduct.js
// -----------------------------------------------------------------------------
// Pure data transformation: take the decoded NHTSA specs + the listing details
// the user passed in, and produce the exact JSON shape the Shopify Admin REST
// API expects when creating a product.
//
// "Pure" means this file does no I/O — no network, no env vars, no side effects.
// Give it the same inputs and it always returns the same output. That makes it
// trivial to test: call it, inspect the object, no mocking required.
// -----------------------------------------------------------------------------

/**
 * Escape characters that have special meaning in HTML, so user-supplied text
 * (like notes) can't break the layout or inject markup into body_html.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Join the parts of a title, dropping any that are blank, and collapse extra
 * spaces. e.g. ("2020", "Honda", "Civic", "") -> "2020 Honda Civic".
 */
function buildTitle(parts) {
  return parts
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Build a clean HTML description: a specs table plus an optional notes section.
 */
function buildBodyHtml(specRows, notes) {
  const rows = specRows
    .filter(([, value]) => value) // skip spec rows with no value
    .map(
      ([label, value]) =>
        `    <tr><th style="text-align:left;padding-right:12px">${escapeHtml(
          label
        )}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("\n");

  let html = `<h3>Vehicle Specifications</h3>\n<table>\n${rows}\n</table>`;

  if (notes && notes.trim()) {
    html += `\n<h3>Additional Notes</h3>\n<p>${escapeHtml(notes.trim())}</p>`;
  }

  return html;
}

/**
 * Turn decoded specs + listing input into a Shopify product payload.
 *
 * This is a plain (non-async) function because it touches nothing external — it
 * just rearranges data in memory and returns immediately.
 *
 * @param {object} args
 * @param {object} args.decoded   - the { Make, Model, ... } object from decodeVin
 * @param {string} args.vin       - the validated VIN (used as the SKU)
 * @param {object} args.listing   - user-supplied details (price, condition, etc.)
 * @returns {object} a payload ready to POST to Shopify as { product: {...} }
 */
export function buildProduct({ decoded, vin, listing }) {
  const {
    Make,
    Model,
    ModelYear,
    Trim,
    BodyClass,
    EngineCylinders,
    FuelTypePrimary,
    TransmissionStyle,
    DriveType,
    Manufacturer,
    PlantCountry,
  } = decoded;

  const {
    price,
    condition,
    mileage,
    photoUrls = [],
    notes = "",
    // These two are configurable per the spec, with sensible defaults.
    productType = "Used Vehicle",
    status = "draft",
  } = listing;

  const title = buildTitle([ModelYear, Make, Model, Trim]);

  // The spec table. The notes section is prepended with the listing's own
  // condition/mileage so buyers see them right alongside the decoded specs.
  const specRows = [
    ["Year", ModelYear],
    ["Make", Make],
    ["Model", Model],
    ["Trim", Trim],
    ["Condition", condition],
    ["Mileage", mileage != null ? `${mileage} mi` : ""],
    ["Body Style", BodyClass],
    ["Cylinders", EngineCylinders],
    ["Fuel Type", FuelTypePrimary],
    ["Transmission", TransmissionStyle],
    ["Drivetrain", DriveType],
    ["Manufacturer", Manufacturer],
    ["Built In", PlantCountry],
    ["VIN", vin],
  ];

  const bodyHtml = buildBodyHtml(specRows, notes);

  // Tags help merchandising/filtering in Shopify. Drop blanks and dedupe.
  const tags = [
    ModelYear,
    Make,
    Model,
    BodyClass,
    FuelTypePrimary,
    DriveType,
  ]
    .map((t) => (t ?? "").toString().trim())
    .filter(Boolean);

  // Shopify wants images as an array of { src: "https://..." } objects.
  const images = photoUrls
    .filter((u) => typeof u === "string" && u.trim())
    .map((u) => ({ src: u.trim() }));

  // The final shape Shopify's "create product" endpoint expects.
  return {
    product: {
      title,
      body_html: bodyHtml,
      vendor: Make, // e.g. "Honda"
      product_type: productType,
      status, // "draft" by default so staff can review first
      tags: [...new Set(tags)].join(", "), // REST API takes a comma string
      variants: [
        {
          // price must be a string in Shopify's REST API.
          price: price != null ? String(price) : "0.00",
          sku: vin, // each car is unique, so the VIN is a perfect SKU
          inventory_management: "shopify", // let Shopify track stock
          inventory_quantity: 1, // exactly one of each car
          requires_shipping: true,
          weight: 0, // shipping handled separately for now
        },
      ],
      images,
    },
  };
}
