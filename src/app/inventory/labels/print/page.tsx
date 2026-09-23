import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { parts } from "@/db/schema";
import { PrintTrigger } from "../../../quotes/[id]/print/PrintTrigger";
import { code128Svg } from "@/lib/barcodeSvg";
import { LABEL_FORMATS, labelFormat, parseLabelItems } from "@/lib/labels";

// Printable barcode labels. Items come from ?items=id:qty,… (builder, part
// page, PO page) or ?missing=1 (every active part with no box barcode,
// optionally one ?category). ?format picks the label stock; ?skip leaves the
// first N positions blank on a partly used Avery sheet.
const MAX_LABELS = 1500;

export default async function PrintLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ items?: string; missing?: string; category?: string; format?: string; skip?: string }>;
}) {
  const sp = await searchParams;
  const formatKey = labelFormat(sp.format);
  const fmt = LABEL_FORMATS[formatKey];

  let wanted = parseLabelItems(sp.items);
  if (sp.missing === "1") {
    const rows = await db
      .select({ id: parts.id })
      .from(parts)
      .where(
        and(
          eq(parts.archived, false),
          or(isNull(parts.barcode), eq(parts.barcode, "")),
          sp.category ? eq(parts.category, sp.category) : undefined,
        ),
      )
      .orderBy(asc(parts.sku));
    wanted = [...wanted, ...rows.map((r) => ({ partId: r.id, copies: 1 }))];
  }

  const ids = [...new Set(wanted.map((w) => w.partId))];
  const partRows = ids.length
    ? await db.select({ id: parts.id, sku: parts.sku, name: parts.name }).from(parts).where(inArray(parts.id, ids))
    : [];
  const byId = new Map(partRows.map((p) => [p.id, p]));

  // One entry per physical label, in the order requested. Barcodes are
  // rendered once per part and reused for its copies.
  const svgBySku = new Map<string, string | null>();
  const labels: { sku: string; name: string; svg: string | null }[] = [];
  for (const w of wanted) {
    const p = byId.get(w.partId);
    if (!p) continue;
    if (!svgBySku.has(p.sku)) {
      // Stretch the bars to the label's barcode box instead of letterboxing.
      svgBySku.set(p.sku, code128Svg(p.sku)?.replace("<svg ", '<svg preserveAspectRatio="none" ') ?? null);
    }
    for (let i = 0; i < w.copies && labels.length < MAX_LABELS; i++) {
      labels.push({ sku: p.sku, name: p.name, svg: svgBySku.get(p.sku) ?? null });
    }
  }
  const truncated = labels.length >= MAX_LABELS;

  const skip = fmt.sheet ? Math.min(fmt.sheet.cols * fmt.sheet.rows - 1, Math.max(0, Math.trunc(Number(sp.skip) || 0))) : 0;
  const cells: (typeof labels[number] | null)[] = [...Array(skip).fill(null), ...labels];
  const perPage = fmt.sheet ? fmt.sheet.cols * fmt.sheet.rows : 1;
  const pages: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += perPage) pages.push(cells.slice(i, i + perPage));

  // Type scale follows label height so small rolls stay legible.
  const nameSize = fmt.h >= 1.2 ? 8 : 7;
  const skuSize = fmt.h >= 1.2 ? 10 : 8.5;

  const sheetCss = fmt.sheet
    ? `
      @page { size: letter; margin: 0; }
      .page { width: 8.5in; height: 11in; padding: ${fmt.sheet.top}in ${fmt.sheet.left}in 0;
        display: grid; grid-template-columns: repeat(${fmt.sheet.cols}, ${fmt.w}in);
        grid-auto-rows: ${fmt.h}in; column-gap: ${fmt.sheet.colGap}in; align-content: start; }`
    : `
      @page { size: ${fmt.w}in ${fmt.h}in; margin: 0; }
      .page { width: ${fmt.w}in; height: ${fmt.h}in; }`;

  return (
    <div className="labels-doc">
      <PrintTrigger />
      <style>{`
        body { background: white; margin: 0; }
        .labels-doc { color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; }
        .actions { padding: 12px 16px; border-bottom: 1px solid #ccc; font-size: 13px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .actions button, .actions a { font-size: 13px; padding: 4px 10px; border: 1px solid #000; background: #fff; color: #000; cursor: pointer; text-decoration: none; }
        .actions .tip { color: #555; }
        .actions .warn { color: #b45309; }
        .sheets { padding: 16px; display: flex; flex-direction: column; gap: 16px; align-items: flex-start; }
        .page { box-sizing: border-box; background: #fff; outline: 1px dashed #bbb; overflow: hidden; }
        ${sheetCss}
        /* Side padding doubles as the barcode's quiet zone (blank margin scanners need). */
        .label { box-sizing: border-box; width: ${fmt.w}in; height: ${fmt.h}in; padding: 0.06in 0.16in;
          display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
        .label .name { font-size: ${nameSize}pt; font-weight: bold; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .label .bars { flex: 1; min-height: 0; margin: 0.03in 0; }
        .label .bars svg { width: 100%; height: 100%; display: block; }
        .label .sku { font-family: "Courier New", monospace; font-size: ${skuSize}pt; font-weight: bold; text-align: center; letter-spacing: 0.5px; }
        .label .bad { font-size: 7pt; color: #b91c1c; }
        @media print {
          .actions { display: none; }
          .sheets { padding: 0; gap: 0; display: block; }
          .page { outline: none; break-after: page; }
          .page:last-child { break-after: auto; }
        }
      `}</style>

      <div className="actions">
        <button type="button" id="__print">Print</button>
        <a href="/inventory/labels">Back to label builder</a>
        <span className="tip">
          {labels.length} label(s) · {fmt.label}. In the print dialog set <b>Scale: 100% / Actual size</b> and{" "}
          <b>Margins: None</b>
          {fmt.sheet ? ", paper Letter." : `, paper ${fmt.w}" × ${fmt.h}" (your label printer's size).`}
        </span>
        {truncated ? <span className="warn">Capped at {MAX_LABELS} labels — print in batches.</span> : null}
      </div>

      {labels.length === 0 ? (
        <p style={{ padding: 16 }}>No labels to print. Go back and add parts.</p>
      ) : (
        <div className="sheets">
          {pages.map((cellsOnPage, pi) => (
            <div className="page" key={pi}>
              {cellsOnPage.map((c, ci) =>
                c ? (
                  <div className="label" key={ci}>
                    <div className="name">{c.name}</div>
                    {c.svg ? (
                      <div className="bars" dangerouslySetInnerHTML={{ __html: c.svg }} />
                    ) : (
                      <div className="bad">This SKU has characters a barcode can&apos;t hold — edit the SKU.</div>
                    )}
                    <div className="sku">{c.sku}</div>
                  </div>
                ) : (
                  <div className="label" key={ci} />
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
