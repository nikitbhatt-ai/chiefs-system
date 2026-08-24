// Parser for the package bulk-import CSV. One row per component, grouped by
// package name; a package is the set of rows sharing a name. Parsing here is
// pure — it produces a structured, per-row-validated intermediate. Resolving
// part SKUs against the live catalog and building the final PackageComponent[]
// happens in the import API route (which has DB access).
//
// Lenient by design (2026-08-04): real vendor/package templates rarely carry a
// component_type column or a clean row per line. So:
//   • Only a package-name column is required. component_type is optional —
//     inferred per row (has hours & no sku → labor; amount only → fee; else a
//     part) and defaulted to "item".
//   • A blank package-name cell inherits the last row's name, the way section
//     templates repeat a title only on the first line.
//   • Structural rows (blank lines, section dividers with no data) are dropped
//     silently, not reported as errors.
//   • Unparseable numbers coerce to blank with a warning; the row still imports.
// Defaults/coercions surface as row `warnings` so nothing changes silently.
import { parseCsv } from "@/lib/csv";

export type ComponentType = "item" | "labor" | "fee";

export type RawComponentRow = {
  rowNumber: number;
  componentType: ComponentType;
  sku: string;
  label: string;
  quantity: number | null;
  unitPrice: number | null;
  hours: number | null;
  rate: number | null;
  amount: number | null;
  // Hard problems that drop THIS row (kept for forward-compat; nothing sets one
  // today — every real problem is now either a silent structural drop or a
  // warning). The route treats a non-empty errors[] as "skip this row".
  errors: string[];
  // Soft problems: the row still imports, but a value was defaulted or coerced.
  warnings: string[];
};

export type ParsedPackage = {
  name: string;
  category: string | null;
  description: string | null;
  // Optional sell-side bundle/deal price for the whole package's parts. Package-
  // level, so it's read from whichever row in the block supplies it first.
  packagePrice: number | null;
  rows: RawComponentRow[];
};

const HEADER_ALIASES: Record<string, string> = {
  package_name: "packageName",
  package: "packageName",
  name: "packageName",
  // Vendor/package templates label the grouping column "Template Name".
  template_name: "packageName",
  template: "packageName",
  package_category: "packageCategory",
  category: "packageCategory",
  package_description: "packageDescription",
  // Sell-side bundle/deal price for the package (a promo the customer is quoted
  // at). Package-level column; allocated across the part lines on a quote.
  package_price: "packagePrice",
  bundle_price: "packagePrice",
  promo_price: "packagePrice",
  deal_price: "packagePrice",
  net_price: "packagePrice",
  component_type: "componentType",
  type: "componentType",
  kind: "componentType",
  sku: "sku",
  part_sku: "sku",
  part_number: "sku",
  part_no: "sku",
  partno: "sku",
  manufacturer_sku: "sku",
  mfg_sku: "sku",
  mfr_sku: "sku",
  item_number: "sku",
  label: "label",
  item_description: "label",
  part_description: "label",
  part_desc: "label",
  description: "label",
  quantity: "quantity",
  qty: "quantity",
  unit_price: "unitPrice",
  price: "unitPrice",
  sell_price: "unitPrice",
  hours: "hours",
  labor_hours: "hours",
  rate: "rate",
  labor_rate: "rate",
  amount: "amount",
  fee_amount: "amount",
};

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? null;
}

function normalizeType(v: string): ComponentType | null {
  const t = v.trim().toLowerCase();
  if (t === "part" || t === "item" || t === "parts") return "item";
  if (t === "labor" || t === "labour") return "labor";
  if (t === "fee" || t === "add-on" || t === "addon") return "fee";
  return null;
}

export function parsePackageCsv(text: string): {
  packages: ParsedPackage[];
  fatalError: string | null;
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return { packages: [], fatalError: "Empty file" };
  const header = rows[0].map(normalizeHeader);
  // Only the package-name column is required — it's how rows are grouped into
  // packages, and there's nothing sensible to default it to. Everything else,
  // including component_type, is optional.
  if (!header.includes("packageName")) {
    const seen = rows[0].map((h) => h.trim()).filter(Boolean).join(", ");
    return {
      packages: [],
      fatalError:
        `Couldn't find a package-name column — this is the one column the import ` +
        `needs, since it groups rows into packages. Name it any of: package_name, ` +
        `template_name, package, or name. Detected headers: ${seen || "(none)"}.`,
    };
  }
  const hasTypeColumn = header.includes("componentType");
  const idx = (k: string) => header.indexOf(k);

  // Preserve first-seen order of packages while grouping rows by name.
  const order: string[] = [];
  const byName = new Map<string, ParsedPackage>();
  // Templates often print the package/section title only on the first row of a
  // block and leave it blank after; carry the last non-empty name forward.
  let lastPackageName = "";

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (k: string) => {
      const i = idx(k);
      return i < 0 ? "" : (cells[i] ?? "").trim();
    };
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNumber = r + 1;

    const num = (v: string, label: string): number | null => {
      if (!v) return null;
      const n = Number(v.replace(/[$,]/g, ""));
      if (!Number.isFinite(n)) {
        warnings.push(`${label} not a number (${v}) — left blank`);
        return null;
      }
      return n;
    };

    const sku = get("sku");
    const label = get("label");
    const quantity = num(get("quantity"), "quantity");
    const unitPrice = num(get("unitPrice"), "unit_price");
    const hours = num(get("hours"), "hours");
    const rate = num(get("rate"), "rate");
    const amount = num(get("amount"), "amount");

    // A row with nothing usable is structural noise (blank line, a section
    // divider like "SEATING & PRISONER AREA" with no part). Drop it silently.
    const hasContent =
      sku || label || quantity != null || unitPrice != null || hours != null || rate != null || amount != null;
    if (!hasContent) continue;

    const rawPackageName = get("packageName");
    const packageName = rawPackageName || lastPackageName;
    if (rawPackageName) lastPackageName = rawPackageName;
    if (!packageName) errors.push("no package name, and no earlier row to inherit one from");

    // Component type: use the explicit value if given, else infer. Only warn
    // when a type column exists but this cell is blank/unrecognized — if the
    // file has no type column at all, defaulting to a part is expected and
    // silent (the common case for a parts-only template).
    const rawType = get("componentType");
    let componentType = rawType ? normalizeType(rawType) : null;
    if (componentType == null) {
      if (!sku && hours != null) componentType = "labor";
      else if (!sku && amount != null && unitPrice == null) componentType = "fee";
      else componentType = "item";
      if (hasTypeColumn && rawType) warnings.push(`unrecognized type "${rawType}" — treated as ${componentType}`);
      else if (hasTypeColumn) warnings.push(`type blank — treated as ${componentType}`);
    }

    // An item with neither a SKU nor a label can't be described — treat it as
    // structural and drop silently (already mostly caught by hasContent).
    if (componentType === "item" && !sku && !label) continue;

    const row: RawComponentRow = {
      rowNumber,
      componentType,
      sku,
      label,
      quantity,
      unitPrice,
      hours,
      rate,
      amount,
      errors,
      warnings,
    };

    // Package-level bundle price — read from whichever row supplies it first.
    const priceRaw = get("packagePrice");
    const priceNum = priceRaw ? Number(priceRaw.replace(/[$,]/g, "")) : null;
    const bundlePrice = priceNum != null && Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null;
    if (priceRaw && bundlePrice == null) warnings.push(`package_price not a positive number (${priceRaw}) — ignored`);

    const key = packageName || `__row_${rowNumber}__`;
    let pkg = byName.get(key.toLowerCase());
    if (!pkg) {
      pkg = {
        name: packageName,
        category: get("packageCategory") || null,
        description: get("packageDescription") || null,
        packagePrice: bundlePrice,
        rows: [],
      };
      byName.set(key.toLowerCase(), pkg);
      order.push(key.toLowerCase());
    } else {
      // Fill category/description/bundle price from the first row that supplies them.
      if (!pkg.category) pkg.category = get("packageCategory") || null;
      if (!pkg.description) pkg.description = get("packageDescription") || null;
      if (pkg.packagePrice == null) pkg.packagePrice = bundlePrice;
    }
    pkg.rows.push(row);
  }

  return { packages: order.map((k) => byName.get(k)!), fatalError: null };
}
