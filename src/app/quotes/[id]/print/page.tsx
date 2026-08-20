import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { PrintTrigger } from "./PrintTrigger";
import { quoteTotals, lineNet, lineGross, lineDiscount, round2 } from "@/lib/quoteTotals";
import { fmtUSD } from "@/lib/money";
import { quoteDocumentFacts } from "@/lib/quoteDocumentFacts";
import { BRANDING, brandLogoWebPath } from "@/lib/pdf/branding";

type LineGroup = { groupId?: string; groupTitle?: string };
type Line =
  | ({
      kind: "item";
      description: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      discountKind: "pct" | "amt";
      /** Allocated from a package/promo bundle price; line discount is on top. */
      bundleDiscount?: number;
      partId?: string;
    } & LineGroup)
  | ({
      kind: "fee";
      description: string;
      amount: number;
      fixed: boolean;
    } & LineGroup)
  | ({
      kind: "labor";
      description: string;
      hours: number;
      rate: number;
    } & LineGroup);

// The single owner of money formatting — same `$` and two decimals the editor
// and the PDF use, so the three never disagree by a rounding step.
const fmt = fmtUSD;

/**
 * A line's discount as a percentage off its own list value — what gets checked
 * against a contract. Derived from the dollars actually coming off, so a
 * bundle-allocated promo line shows a real percentage rather than a blank.
 */
function discountPct(l: Extract<Line, { kind: "item" }>) {
  const gross = lineGross(l);
  if (gross <= 0) return 0;
  return round2((lineDiscount(l) / gross) * 100);
}

// Parts / Labor / Fees tables for a set of lines. `showTitles` labels
// each sub-table (loose lines); package groups hide them since the
// package name is the section header.
function PrintKindSections({
  lines,
  showTitles,
  partNumbers,
}: {
  lines: Line[];
  showTitles: boolean;
  partNumbers: Record<string, string>;
}) {
  const items = lines.filter((l): l is Extract<Line, { kind: "item" }> => l.kind === "item");
  const labor = lines.filter((l): l is Extract<Line, { kind: "labor" }> => l.kind === "labor");
  const fees = lines.filter((l): l is Extract<Line, { kind: "fee" }> => l.kind === "fee");
  return (
    <>
      {items.length > 0 ? (
        <div style={{ marginBottom: "12pt" }}>
          {showTitles ? <div className="section-title">Parts &amp; Items</div> : null}
          <table>
            <thead>
              <tr>
                <th style={{ width: "4%" }}>#</th>
                <th style={{ width: "39%" }}>Description</th>
                <th style={{ width: "15%" }}>Part #</th>
                <th className="right" style={{ width: "7%" }}>Qty</th>
                <th className="right" style={{ width: "12%" }}>Unit price</th>
                <th className="right" style={{ width: "10%" }}>Disc %</th>
                <th className="right" style={{ width: "13%" }}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l, i) => {
                // Shared money module: a bundle/promo allocation lives in its own
                // field, so recomputing the discount here printed a different
                // number from the one on screen.
                const gross = lineGross(l);
                const disc = lineDiscount(l);
                const pct = discountPct(l);
                const partNo = l.partId ? partNumbers[l.partId] : undefined;
                return (
                  <tr key={`item-${i}`}>
                    <td>{i + 1}</td>
                    <td>{l.description || "Item"}</td>
                    <td style={{ fontSize: "10pt" }}>{partNo ?? "—"}</td>
                    <td className="right">{l.quantity}</td>
                    <td className="right">{fmt(l.unitPrice)}</td>
                    <td className="right">{pct > 0 ? `${pct.toFixed(2)}%` : "—"}</td>
                    <td className="right">
                      {disc > 0 ? (
                        <>
                          <div style={{ textDecoration: "line-through", color: "#888", fontSize: "9pt" }}>
                            {fmt(gross)}
                          </div>
                          <div style={{ fontWeight: "bold" }}>{fmt(lineNet(l))}</div>
                        </>
                      ) : (
                        fmt(lineNet(l))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {labor.length > 0 ? (
        <div style={{ marginBottom: "12pt" }}>
          {showTitles ? <div className="section-title">Labor</div> : null}
          <table>
            <thead>
              <tr>
                <th style={{ width: "55%" }}>Description</th>
                <th className="right" style={{ width: "15%" }}>Hours</th>
                <th className="right" style={{ width: "15%" }}>Rate / hr</th>
                <th className="right" style={{ width: "15%" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {labor.map((l, i) => (
                <tr key={`labor-${i}`}>
                  <td>{l.description || "Labor"}</td>
                  <td className="right">{l.hours || 0}</td>
                  <td className="right">{fmt(l.rate || 0)}</td>
                  <td className="right">{fmt((l.hours || 0) * (l.rate || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {fees.length > 0 ? (
        <div style={{ marginBottom: "12pt" }}>
          {showTitles ? <div className="section-title">Fees &amp; Add-ons</div> : null}
          <table>
            <thead>
              <tr>
                <th style={{ width: "75%" }}>Description</th>
                <th className="right" style={{ width: "25%" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {fees.map((l, i) => (
                <tr key={`fee-${i}`}>
                  <td>
                    {l.description}{" "}
                    <em style={{ color: "#666" }}>({l.fixed ? "fixed fee" : "custom fee"})</em>
                  </td>
                  <td className="right">{fmt(l.amount || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

export default async function PrintQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) notFound();

  // Same resolver the PDF uses, so the sales rep, contact details and vehicle
  // on screen are the ones that get printed.
  const facts = await quoteDocumentFacts(q);
  const logoPath = brandLogoWebPath();
  const isInvoice = q.status === "converted";

  const lines = (q.lineItems as unknown as Line[]) ?? [];
  const items = lines.filter((l): l is Extract<Line, { kind: "item" }> => l.kind === "item");
  const labor = lines.filter((l): l is Extract<Line, { kind: "labor" }> => l.kind === "labor");
  const fees = lines.filter((l): l is Extract<Line, { kind: "fee" }> => l.kind === "fee");

  // Round each line before summing (shared helper) so the rows foot to grand.
  const t = quoteTotals(lines, 0);
  const subtotal = t.subtotal;
  const discountTotal = t.discountTotal;
  const laborTotal = t.laborTotal;
  const feeTotal = t.feeTotal;
  const tax = Number(q.taxTotal) || 0;
  const grand = round2(subtotal - discountTotal + laborTotal + feeTotal + tax);

  return (
    <div className="print-doc">
      <PrintTrigger />
      <style>{`
        body { background: white; }
        .print-doc {
          font-family: "Times New Roman", Times, serif;
          font-size: 12pt;
          color: #000;
          background: #fff;
          padding: 0.75in;
          max-width: 8.5in;
          margin: 0 auto;
        }
        .print-doc h1, .print-doc h2 { font-family: "Times New Roman", Times, serif; }
        .print-doc table { width: 100%; border-collapse: collapse; }
        .print-doc th, .print-doc td {
          border: 1px solid #000;
          padding: 6pt 8pt;
          text-align: left;
          font-size: 11pt;
        }
        .print-doc th { background: #eee; font-weight: bold; }
        .print-doc .totals td { border: none; padding: 2pt 8pt; }
        .print-doc .totals .grand td {
          border-top: 2pt solid #000;
          font-weight: bold;
          font-size: 13pt;
        }
        .print-doc .right { text-align: right; }
        .print-doc .section-title {
          font-size: 10pt;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.5pt;
          color: #444;
          padding: 6pt 0 3pt;
          border-bottom: 1pt solid #999;
          margin-bottom: 4pt;
        }
        .print-doc .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24pt;
          border-bottom: 2pt solid #000;
          padding-bottom: 12pt;
        }
        .print-doc .meta { font-size: 10pt; color: #444; }
        .print-doc .actions {
          margin-bottom: 12pt;
        }
        @media print {
          .print-doc .actions { display: none; }
          @page { margin: 0.5in; }
        }
        .print-doc button, .print-doc a.btn {
          font-family: "Times New Roman", Times, serif;
          font-size: 11pt;
          padding: 4pt 10pt;
          border: 1px solid #000;
          background: #fff;
          color: #000;
          cursor: pointer;
          text-decoration: none;
          margin-right: 6pt;
        }
      `}</style>

      <div className="actions">
        <button type="button" id="__print">
          Print
        </button>
        <a href={`/quotes/${id}`} className="btn">
          Back to editor
        </a>
        <span style={{ fontSize: "10pt", color: "#666", marginLeft: "12pt" }}>
          Use your browser's print dialog to "Save as PDF".
        </span>
      </div>

      {/* Masthead: logo + company block on the left, document number and the
          assigned sales rep on the right — the same arrangement as the PDF. */}
      <div className="header">
        <div>
          {logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- a print
            // stylesheet document, not an optimised app image.
            <img src={logoPath} alt={BRANDING.companyName} style={{ height: "48pt", marginBottom: "4pt" }} />
          ) : null}
          <h1 style={{ fontSize: logoPath ? "13pt" : "20pt", margin: 0 }}>{BRANDING.companyName}</h1>
          {BRANDING.address ? <div className="meta">{BRANDING.address}</div> : null}
          {BRANDING.phone ? <div className="meta">{BRANDING.phone}</div> : null}
          {BRANDING.email ? <div className="meta">{BRANDING.email}</div> : null}
          {BRANDING.website ? <div className="meta">{BRANDING.website}</div> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "16pt", fontWeight: "bold" }}>{isInvoice ? "INVOICE" : "QUOTE"}</div>
          <div style={{ fontSize: "13pt", fontWeight: "bold" }}>
            {q.quoteNumber ?? q.id.slice(0, 8)}
          </div>
          <div className="meta">
            {isInvoice ? "Invoice date" : "Quote date"}: {new Date(q.createdAt).toLocaleDateString()}
          </div>
          {facts.salesPerson ? (
            <div style={{ fontSize: "10pt" }}>Sales rep: {facts.salesPerson}</div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: "24pt", marginBottom: "16pt" }}>
        <div style={{ width: "48%" }}>
          <div style={{ fontSize: "10pt", color: "#666", textTransform: "uppercase", letterSpacing: "0.5pt" }}>
            {isInvoice ? "Bill to" : "Prepared for"}
          </div>
          <div style={{ fontWeight: "bold", marginTop: "2pt" }}>{facts.customerName ?? "—"}</div>
          {facts.customerAddress ? <div>{facts.customerAddress}</div> : null}
          {facts.customerPhone ? <div>{facts.customerPhone}</div> : null}
          {facts.customerEmail ? <div>{facts.customerEmail}</div> : null}
        </div>
        <div style={{ width: "48%" }}>
          {/* Engine and transmission are not shown because the app does not
              record them — a blank line beats an invented one. */}
          <div style={{ fontSize: "10pt", color: "#666", textTransform: "uppercase", letterSpacing: "0.5pt" }}>
            Vehicle
          </div>
          <div style={{ fontWeight: "bold", marginTop: "2pt" }}>{facts.vehicleSummary ?? "—"}</div>
          {facts.vin ? <div>VIN: {facts.vin}</div> : null}
          {facts.unitNumber ? <div>Unit #: {facts.unitNumber}</div> : null}
          {facts.vehicleColor ? <div>Color: {facts.vehicleColor}</div> : null}
          {facts.vehicleMileage != null ? (
            <div>Mileage: {facts.vehicleMileage.toLocaleString("en-US")}</div>
          ) : null}
          <div className="meta" style={{ marginTop: "3pt" }}>Status: {q.status.replace(/_/g, " ")}</div>
        </div>
      </div>

      {lines.length === 0 ? (
        <div style={{ textAlign: "center", color: "#666", padding: "16pt 0" }}>
          (no line items)
        </div>
      ) : (
        (() => {
          // Package groups render first as titled sections; loose lines
          // follow under the standard Parts / Labor / Fees headings.
          const groupOrder: string[] = [];
          const groupMap = new Map<string, Line[]>();
          const loose: Line[] = [];
          for (const l of lines) {
            if (l.groupId) {
              if (!groupMap.has(l.groupId)) {
                groupMap.set(l.groupId, []);
                groupOrder.push(l.groupId);
              }
              groupMap.get(l.groupId)!.push(l);
            } else {
              loose.push(l);
            }
          }
          return (
            <>
              {groupOrder.map((gid) => {
                const gl = groupMap.get(gid)!;
                const title = gl[0]?.groupTitle ?? "Package";
                return (
                  <div key={gid} style={{ marginBottom: "12pt" }}>
                    <div
                      className="section-title"
                      style={{ background: "#e5e7eb", fontWeight: "bold" }}
                    >
                      {title}
                    </div>
                    <PrintKindSections lines={gl} showTitles={false} partNumbers={facts.partNumbers} />
                  </div>
                );
              })}
              {loose.length > 0 ? <PrintKindSections lines={loose} showTitles={true} partNumbers={facts.partNumbers} /> : null}
            </>
          );
        })()
      )}

      <table className="totals" style={{ marginTop: "12pt" }}>
        <tbody>
          <tr>
            <td style={{ width: "75%" }} className="right">Subtotal</td>
            <td className="right">{fmt(subtotal)}</td>
          </tr>
          {discountTotal > 0 ? (
            <tr>
              <td className="right">Discount</td>
              <td className="right">− {fmt(discountTotal)}</td>
            </tr>
          ) : null}
          {laborTotal > 0 ? (
            <tr>
              <td className="right">Labor</td>
              <td className="right">{fmt(laborTotal)}</td>
            </tr>
          ) : null}
          {feeTotal > 0 ? (
            <tr>
              <td className="right">Fees</td>
              <td className="right">{fmt(feeTotal)}</td>
            </tr>
          ) : null}
          {tax > 0 ? (
            <tr>
              <td className="right">Tax</td>
              <td className="right">{fmt(tax)}</td>
            </tr>
          ) : null}
          <tr className="grand">
            <td className="right">Grand total</td>
            <td className="right">{fmt(grand)}</td>
          </tr>
        </tbody>
      </table>

      {q.notes ? (
        <div style={{ marginTop: "20pt" }}>
          <div style={{ fontSize: "10pt", color: "#666", textTransform: "uppercase", letterSpacing: "0.5pt" }}>
            Notes
          </div>
          <div style={{ marginTop: "4pt", whiteSpace: "pre-wrap" }}>{q.notes}</div>
        </div>
      ) : null}

      <div style={{ marginTop: "32pt", fontSize: "9pt", color: "#666", textAlign: "center" }}>
        Generated by Chiefs Pursuit Surplus ERP · {new Date().toLocaleString()}
      </div>
    </div>
  );
}
