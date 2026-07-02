// Parser for the package bulk-import CSV. One row per component, grouped by
// `package_name`; a package is the set of consecutive-or-not rows sharing a
// name. Parsing here is pure — it produces a structured, per-row-validated
// intermediate. Resolving part SKUs against the live catalog and building the
// final PackageComponent[] happens in the import API route (which has DB
// access), so inventory must be loaded first for `part` rows to link.
import { parseCsv } from "@/lib/csv";

export type ComponentType = "item" | "labor" | "fee";

export type RawComponentRow = {
  rowNumber: number;
  componentType: ComponentType | null;
  sku: string;
  label: string;
  quantity: number | null;
  unitPrice: number | null;
  hours: number | null;
  rate: number | null;
  amount: number | null;
  errors: string[];
};

export type ParsedPackage = {
  name: string;
  category: string | null;
  description: string | null;
  rows: RawComponentRow[];
};

const HEADER_ALIASES: Record<string, string> = {
  package_name: "packageName",
  package: "packageName",
  name: "packageName",
  package_category: "packageCategory",
  category: "packageCategory",
  package_description: "packageDescription",
  component_type: "componentType",
  type: "componentType",
  kind: "componentType",
  sku: "sku",
  part_sku: "sku",
  label: "label",
  item_description: "label",
  description: "label",
  quantity: "quantity",
  qty: "quantity",
  unit_price: "unitPrice",
  price: "unitPrice",
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
  if (!header.includes("packageName") || !header.includes("componentType")) {
    return {
      packages: [],
      fatalError: "Header must include 'package_name' and 'component_type' columns",
    };
  }
  const idx = (k: string) => header.indexOf(k);

  // Preserve first-seen order of packages while grouping rows by name.
  const order: string[] = [];
  const byName = new Map<string, ParsedPackage>();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (k: string) => {
      const i = idx(k);
      return i < 0 ? "" : (cells[i] ?? "").trim();
    };
    const errors: string[] = [];
    const rowNumber = r + 1;

    const packageName = get("packageName");
    if (!packageName) {
      // A row with no package name is unusable — record it against a
      // synthetic bucket so the user sees the error rather than silent drop.
      errors.push("missing package_name");
    }

    const num = (v: string, label: string): number | null => {
      if (!v) return null;
      const n = Number(v.replace(/[$,]/g, ""));
      if (!Number.isFinite(n)) {
        errors.push(`${label} not a number: ${v}`);
        return null;
      }
      return n;
    };

    const componentTypeRaw = get("componentType");
    const componentType = componentTypeRaw ? normalizeType(componentTypeRaw) : null;
    if (!componentTypeRaw) errors.push("missing component_type");
    else if (!componentType) errors.push(`unknown component_type: ${componentTypeRaw}`);

    const sku = get("sku");
    if (componentType === "item" && !sku) errors.push("part rows require a sku");

    const row: RawComponentRow = {
      rowNumber,
      componentType,
      sku,
      label: get("label"),
      quantity: num(get("quantity"), "quantity"),
      unitPrice: num(get("unitPrice"), "unit_price"),
      hours: num(get("hours"), "hours"),
      rate: num(get("rate"), "rate"),
      amount: num(get("amount"), "amount"),
      errors,
    };

    const key = packageName || `__row_${rowNumber}__`;
    let pkg = byName.get(key.toLowerCase());
    if (!pkg) {
      pkg = {
        name: packageName,
        category: get("packageCategory") || null,
        description: get("packageDescription") || null,
        rows: [],
      };
      byName.set(key.toLowerCase(), pkg);
      order.push(key.toLowerCase());
    } else {
      // Fill category/description from the first row that supplies them.
      if (!pkg.category) pkg.category = get("packageCategory") || null;
      if (!pkg.description) pkg.description = get("packageDescription") || null;
    }
    pkg.rows.push(row);
  }

  return { packages: order.map((k) => byName.get(k)!), fatalError: null };
}
