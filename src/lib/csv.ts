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
  // Hard problems that stop THIS row from importing (in lenient mode, only a
  // missing or duplicate SKU — the one field we can't invent, since it's the
  // identity used to match on re-upload). Everything else is a warning.
  errors: string[];
  // Soft problems: the row still imports, but a value was defaulted or coerced
  // (missing name → SKU, unparseable cost → blank, etc.). Surfaced in the
  // preview so nothing is silently changed. In strict mode these are promoted
  // to hard errors and the row is skipped instead.
  warnings: string[];
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
  // Vendor/package sheets label the descriptive column "Part Description".
  // When there's no dedicated name column, name falls back to this (below).
  part_description: "description",
  part_desc: "description",
  item_description: "description",
  category: "category",
  section: "category",
  manufacturer: "manufacturer",
  brand: "manufacturer",
  supplier: "supplier",
  vendor: "supplier",
  internal_cost: "internalCost",
  cost: "internalCost",
  unit_cost: "internalCost",
  price: "price",
  sell_price: "price",
  unit_price: "price",
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
  // Only the SKU column is truly required — it's the identity we upsert on and
  // can't invent. A missing name (or anything else) is handled per-row with a
  // default, not a file-level rejection, so partial vendor/package sheets still
  // import. If the SKU column itself is absent there's nothing to key on, so
  // that stays fatal, with the accepted labels spelled out.
  if (!header.includes("sku")) {
    const seen = rows[0].map((h) => h.trim()).filter(Boolean).join(", ");
    return {
      parsed: [],
      fatalError:
        `Couldn't find a SKU column — this is the one column the import needs, ` +
        `since it identifies each part. Name it any of: SKU, Part Number, ` +
        `Manufacturer SKU, MFG SKU, Part No, or Item Number. ` +
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
    const warnings: string[] = [];

    const sku = get("sku");
    const rawName = get("name");
    const rawDescription = get("description");

    // Numbers are coerced, never fatal: an unparseable value defaults and logs
    // a warning so the row still imports.
    const num = (v: string, label: string): string | null => {
      if (!v) return null;
      const n = Number(v.replace(/[$,]/g, ""));
      if (Number.isNaN(n)) {
        warnings.push(`${label} not a number (${v}) — left blank`);
        return null;
      }
      return n.toFixed(2);
    };
    const intNum = (v: string, label: string, dflt: number | null = 0): number | null => {
      if (!v) return dflt;
      const n = Number(v.replace(/[,]/g, ""));
      if (Number.isNaN(n) || !Number.isFinite(n)) {
        warnings.push(`${label} not a whole number (${v}) — used ${dflt ?? "blank"}`);
        return dflt;
      }
      return Math.trunc(n);
    };

    const internalCost = num(get("internalCost"), "cost");
    const price = num(get("price"), "price");
    const quantityOnHand = intNum(get("quantityOnHand"), "quantity_on_hand", 0) ?? 0;
    const quantityOnOrder = intNum(get("quantityOnOrder"), "quantity_on_order", 0) ?? 0;
    const reorderPoint = intNum(get("reorderPoint"), "reorder_point", null);

    // Rows with nothing usable are structural noise (blank lines, section
    // dividers like "SEATING & PRISONER AREA"). Drop them silently rather than
    // cluttering the report — they were never meant to be parts.
    const hasAnyData =
      sku || rawName || rawDescription || internalCost || price ||
      quantityOnHand || quantityOnOrder || reorderPoint != null;
    if (!hasAnyData) continue;

    // Name is never a blocker: fall back to the description, then the SKU.
    const name = rawName || rawDescription || sku;
    if (!rawName && name) {
      warnings.push(`name missing — used ${rawDescription ? "the description" : "the SKU"}`);
    }

    // SKU is the one thing we can't default. Without it the row can't be
    // created or matched, so it's a hard skip — but only this row, not the file.
    if (!sku) errors.push("no SKU / Part Number — can't identify the part, so this row is skipped");

    parsed.push({
      rowNumber: r + 1,
      sku,
      name,
      description: rawDescription || null,
      category: get("category") || null,
      manufacturer: get("manufacturer") || null,
      supplier: get("supplier") || null,
      internalCost,
      price,
      quantityOnHand,
      quantityOnOrder,
      reorderPoint,
      errors,
      warnings,
    });
  }

  // Flag in-file duplicate SKUs. The first occurrence wins; later rows with
  // the same SKU are marked as errors so they surface in the dry-run preview
  // and are skipped, instead of silently colliding on commit (a new SKU would
  // hit a unique-constraint error; an existing one would upsert twice).
  const firstSeen = new Map<string, number>();
  for (const row of parsed) {
    if (!row.sku) continue;
    const firstRow = firstSeen.get(row.sku);
    if (firstRow === undefined) firstSeen.set(row.sku, row.rowNumber);
    else row.errors.push(`duplicate sku in file (first seen on row ${firstRow})`);
  }

  return { parsed, fatalError: null };
}
