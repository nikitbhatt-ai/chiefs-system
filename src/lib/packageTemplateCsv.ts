// Parser for a vendor package-template CSV (e.g. "PIU Whelen Regional Promo").
// Pure — produces a structured intermediate; DB work happens in the importer.
//
// One sheet = one sellable package. Every part line — across every section —
// belongs to that package. A header row that carries a price but NO part number
// (e.g. "Lightbar Regional Promo … $7,200" in the Unit Cost column) is the
// PACKAGE PROMO PRICE: the single discounted cost for all the parts on the
// sheet. That price feeds the allocation engine, spread across the parts by
// their à la carte Unit Cost. A sheet with no such priced header imports at
// plain à la carte (no promo). The Notes column is ignored entirely.
//
// Columns are matched by alias, so vendor templates don't need renaming:
//   Template Name → name · Section → section · Part Number → sku ·
//   Part Description → label · Qty → qty · Unit Cost → unitCost (à la carte) ·
//   Sell Price → sellPrice · Install Hrs (Each) → hours. Everything else
//   (Line #, Discount %, Extended Sell, Notes) is ignored.

import { parseCsv } from "@/lib/csv";

export type TemplateLineKind = "item" | "labor" | "fee";

export type TemplateLine = {
  rowNumber: number;
  section: string | null;
  kind: TemplateLineKind;
  sku: string | null;
  label: string;
  qty: number;
  unitCost: number | null; // à la carte per-unit cost
  sellPrice: number | null;
  hours: number | null;
};

export type ParsedTemplate = {
  name: string;
  // The single promo cost covering every part on the sheet, or null when the
  // sheet carries no package price (à la carte only).
  packagePrice: number | null;
  freight: number | null;
  lines: TemplateLine[];
  warnings: string[];
};

const HEADER_ALIASES: Record<string, string> = {
  template_name: "name",
  package_name: "name",
  package: "name",
  name: "name",
  section: "section",
  part_number: "sku",
  part_no: "sku",
  partno: "sku",
  sku: "sku",
  manufacturer_sku: "sku",
  mfg_sku: "sku",
  mfr_sku: "sku",
  item_number: "sku",
  part_description: "label",
  part_desc: "label",
  item_description: "label",
  description: "label",
  label: "label",
  qty: "qty",
  quantity: "qty",
  unit_cost: "unitCost",
  cost: "unitCost",
  sell_price: "sellPrice",
  price: "sellPrice",
  unit_price: "sellPrice",
  "install_hrs_(each)": "hours",
  install_hrs: "hours",
  hours: "hours",
  labor_hours: "hours",
};

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? null;
}

function num(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function kindForSection(section: string | null): TemplateLineKind {
  const s = (section ?? "").toLowerCase();
  if (s.includes("labor") || s.includes("labour")) return "labor";
  if (s.includes("fee")) return "fee";
  return "item";
}

export function parsePackageTemplateCsv(text: string): {
  templates: ParsedTemplate[];
  fatalError: string | null;
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return { templates: [], fatalError: "Empty file." };

  const header = rows[0].map(normalizeHeader);
  if (!header.includes("name")) {
    const seen = rows[0].map((h) => h.trim()).filter(Boolean).join(", ");
    return {
      templates: [],
      fatalError:
        `Couldn't find a template-name column (accepted: template_name, package_name, package, name). ` +
        `Detected headers: ${seen || "(none)"}.`,
    };
  }
  const idx = (k: string) => header.indexOf(k);
  const cell = (cells: string[], k: string) => {
    const i = idx(k);
    return i < 0 ? "" : (cells[i] ?? "").trim();
  };

  const order: string[] = [];
  const byName = new Map<string, ParsedTemplate>();
  let lastName = "";
  let lastSection = "";

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const rowNumber = r + 1;

    const rawName = cell(cells, "name");
    if (rawName) lastName = rawName;
    const name = rawName || lastName;

    const rawSection = cell(cells, "section");
    if (rawSection) lastSection = rawSection;
    const section = rawSection || lastSection || null;

    const sku = cell(cells, "sku") || null;
    const label = cell(cells, "label");
    const qty = num(cell(cells, "qty"));
    const unitCost = num(cell(cells, "unitCost"));
    const sellPrice = num(cell(cells, "sellPrice"));
    const hours = num(cell(cells, "hours"));

    // Nothing usable → structural noise (blank line, bare section divider). Drop.
    const hasContent = sku || label || qty != null || unitCost != null || sellPrice != null || hours != null;
    if (!hasContent) continue;
    if (!name) continue; // no template to attach to

    const key = name.toLowerCase();
    let tpl = byName.get(key);
    if (!tpl) {
      tpl = { name, packagePrice: null, freight: null, lines: [], warnings: [] };
      byName.set(key, tpl);
      order.push(key);
    }

    // A priced row with NO part number is the package promo price (or freight).
    // Sum across such rows so a sheet could split price + freight if it wanted.
    if (!sku && unitCost != null) {
      const isFreight = /freight|shipping/i.test(label);
      if (isFreight) {
        tpl.freight = (tpl.freight ?? 0) + unitCost;
      } else {
        tpl.packagePrice = (tpl.packagePrice ?? 0) + unitCost;
      }
      continue; // never a component line
    }

    const kind = kindForSection(section);

    // An item with neither a SKU nor a label is structural — drop.
    if (kind === "item" && !sku && !label) continue;

    tpl.lines.push({
      rowNumber,
      section,
      kind,
      sku,
      label: label || sku || "(unnamed)",
      qty: qty != null && qty > 0 ? Math.trunc(qty) : 1,
      unitCost,
      sellPrice,
      hours,
    });
  }

  return { templates: order.map((k) => byName.get(k)!), fatalError: null };
}
