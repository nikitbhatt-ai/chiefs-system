// Barcode labels for parts that arrive without a usable barcode. The label
// encodes the part's SKU as Code 128 (letters, digits, dashes — what our SKUs
// are). No new numbers are invented: SKUs are unique and the scan lookup
// (src/lib/scan.ts) already matches SKU exactly, so a printed label scans
// straight to its part everywhere — header Scan, PO receive, work-order pulls.

// Label stock we lay out for. Sizes in inches. `sheet` formats tile labels on
// a Letter page (office printer); the rest print one label per page, which is
// how browser printing drives thermal label printers (Zebra, Rollo, DYMO).
export const LABEL_FORMATS = {
  avery5160: {
    label: 'Avery 5160 sheet — 30 per page (2⅝" × 1")',
    w: 2.625,
    h: 1,
    sheet: { cols: 3, rows: 10, top: 0.5, left: 0.1875, colGap: 0.125 },
  },
  thermal2x1: { label: 'Thermal roll 2" × 1"', w: 2, h: 1, sheet: null },
  thermal225x125: { label: 'Thermal roll 2¼" × 1¼" (common Zebra/Rollo)', w: 2.25, h: 1.25, sheet: null },
  dymo30252: { label: 'DYMO 30252 address label (3½" × 1⅛")', w: 3.5, h: 1.125, sheet: null },
} as const;

export type LabelFormat = keyof typeof LABEL_FORMATS;

export function labelFormat(key: string | null | undefined): LabelFormat {
  return key && key in LABEL_FORMATS ? (key as LabelFormat) : "avery5160";
}

// "id:qty,id:qty" — the compact item list the builder, part page and PO page
// hand to the print view in its URL.
export function parseLabelItems(raw: string | null | undefined): { partId: string; copies: number }[] {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out: { partId: string; copies: number }[] = [];
  for (const chunk of (raw ?? "").split(",")) {
    const [id, qty] = chunk.split(":");
    if (!id || !uuid.test(id)) continue;
    const copies = Math.min(500, Math.max(1, Math.trunc(Number(qty) || 1)));
    out.push({ partId: id, copies });
  }
  return out;
}

export function formatLabelItems(items: { partId: string; copies: number }[]): string {
  return items.map((i) => `${i.partId}:${i.copies}`).join(",");
}
