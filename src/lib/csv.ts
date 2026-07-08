// Minimal RFC-4180 CSV parser. Handles quoted fields, embedded commas,
// embedded newlines, and "" as an escaped quote. Returns array of rows
// where each row is an array of strings. Empty trailing rows are skipped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  // Strip BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // ignore — handled by \n
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      cell = "";
      // skip rows that are entirely empty
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  // last cell / row
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

export type ImportRow = {
  rowNumber: number;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  supplier: string | null;
  internalCost: string | null;
  price: string | null;
  quantityOnHand: number;
  quantityOnOrder: number;
  reorderPoint: number | null;
  errors: string[];
};

const HEADER_ALIASES: Record<string, string> = {
  sku: "sku",
  // Real-world export headers use qualified SKU labels (e.g. Whelen/vendor
  // sheets export "Manufacturer sku"). We key the catalog on this value, so
  // treat these as the SKU column.
  manufacturer_sku: "sku",
  mfg_sku: "sku",
  mfr_sku: "sku",
  part_number: "sku",
  part_no: "sku",
  partno: "sku",
  item_number: "sku",
  name: "name",
  product_name: "name",
  item_name: "name",
  part_name: "name",
  description: "description",
  category: "category",
  manufacturer: "manufacturer",
  supplier: "supplier",
  vendor: "supplier",
  internal_cost: "internalCost",
  cost: "internalCost",
  price: "price",
  quantity_on_hand: "quantityOnHand",
  on_hand: "quantityOnHand",
  qty_on_hand: "quantityOnHand",
  quantity_on_order: "quantityOnOrder",
  on_order: "quantityOnOrder",
  qty_on_order: "quantityOnOrder",
  reorder_point: "reorderPoint",
};

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? null;
}

export function rowsToImport(rows: string[][]): {
  parsed: ImportRow[];
  fatalError: string | null;
} {
  if (rows.length === 0) return { parsed: [], fatalError: "Empty file" };
  const header = rows[0].map(normalizeHeader);
  const missing = (["sku", "name"] as const).filter((k) => !header.includes(k));
  if (missing.length > 0) {
    const seen = rows[0].map((h) => h.trim()).filter(Boolean).join(", ");
    return {
      parsed: [],
      fatalError:
        `Header is missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        `Detected headers: ${seen || "(none)"}.`,
    };
  }
  const idx = (k: string) => header.indexOf(k);

  const parsed: ImportRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (k: string) => {
      const i = idx(k);
      if (i < 0) return "";
      return (cells[i] ?? "").trim();
    };
    const errors: string[] = [];

    const sku = get("sku");
    const name = get("name");
    if (!sku) errors.push("missing sku");
    if (!name) errors.push("missing name");

    const num = (v: string, label: string): string | null => {
      if (!v) return null;
      const n = Number(v.replace(/[$,]/g, ""));
      if (Number.isNaN(n)) {
        errors.push(`${label} not a number: ${v}`);
        return null;
      }
      return n.toFixed(2);
    };
    const intNum = (v: string, label: string, dflt: number | null = 0): number | null => {
      if (!v) return dflt;
      const n = Number(v.replace(/[,]/g, ""));
      if (Number.isNaN(n) || !Number.isFinite(n)) {
        errors.push(`${label} not an integer: ${v}`);
        return dflt;
      }
      return Math.trunc(n);
    };

    parsed.push({
      rowNumber: r + 1,
      sku,
      name,
      description: get("description") || null,
      category: get("category") || null,
      manufacturer: get("manufacturer") || null,
      supplier: get("supplier") || null,
      internalCost: num(get("internalCost"), "internal_cost"),
      price: num(get("price"), "price"),
      quantityOnHand: intNum(get("quantityOnHand"), "quantity_on_hand", 0) ?? 0,
      quantityOnOrder: intNum(get("quantityOnOrder"), "quantity_on_order", 0) ?? 0,
      reorderPoint: intNum(get("reorderPoint"), "reorder_point", null),
      errors,
    });
  }
  return { parsed, fatalError: null };
}
