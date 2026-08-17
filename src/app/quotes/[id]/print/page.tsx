import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, customers } from "@/db/schema";
import { PrintTrigger } from "./PrintTrigger";

type LineGroup = { groupId?: string; groupTitle?: string };
type Line =
  | ({
      kind: "item";
      description: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      discountKind: "pct" | "amt";
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

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Parts / Labor / Fees tables for a set of lines. `showTitles` labels
// each sub-table (loose lines); package groups hide them since the
// package name is the section header.
function PrintKindSections({ lines, showTitles }: { lines: Line[]; showTitles: boolean }) {
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
                <th style={{ width: "55%" }}>Description</th>
                <th className="right" style={{ width: "8%" }}>Qty</th>
                <th className="right" style={{ width: "12%" }}>Unit price</th>
                <th className="right" style={{ width: "12%" }}>Discount</th>
                <th className="right" style={{ width: "13%" }}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l, i) => {
                const gross = (l.quantity || 0) * (l.unitPrice || 0);
                const disc =
                  l.discountKind === "pct" ? gross * ((l.discount || 0) / 100) : l.discount || 0;
                const discLabel =
                  l.discount > 0
                    ? l.discountKind === "pct"
                      ? `${l.discount}% (−${fmt(disc)})`
                      : `−${fmt(l.discount)}`
                    : "—";
                return (
                  <tr key={`item-${i}`}>
                    <td>{l.description || "Item"}</td>
                    <td className="right">{l.quantity}</td>
                    <td className="right">{fmt(l.unitPrice)}</td>
                    <td className="right">{discLabel}</td>
                    <td className="right">
                      {disc > 0 ? (
                        <>
                          <div style={{ textDecoration: "line-through", color: "#888", fontSize: "9pt" }}>
                            {fmt(gross)}
                          </div>
                          <div style={{ fontWeight: "bold" }}>{fmt(gross - disc)}</div>
                        </>
                      ) : (
                        fmt(gross - disc)
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

  const customer = q.customerId
    ? (await db.select().from(customers).where(eq(customers.id, q.customerId)))[0]
    : null;

  const lines = (q.lineItems as unknown as Line[]) ?? [];
  const items = lines.filter((l): l is Extract<Line, { kind: "item" }> => l.kind === "item");
  const labor = lines.filter((l): l is Extract<Line, { kind: "labor" }> => l.kind === "labor");
  const fees = lines.filter((l): l is Extract<Line, { kind: "fee" }> => l.kind === "fee");

  let subtotal = 0;
  let discountTotal = 0;
  for (const l of items) {
    const gross = (l.quantity || 0) * (l.unitPrice || 0);
    const disc =
      l.discountKind === "pct" ? gross * ((l.discount || 0) / 100) : l.discount || 0;
    subtotal += gross;
    discountTotal += disc;
  }
  const laborTotal = labor.reduce((s, l) => s + (l.hours || 0) * (l.rate || 0), 0);
  const feeTotal = fees.reduce((s, l) => s + (l.amount || 0), 0);
  const tax = Number(q.taxTotal) || 0;
  const grand =
    Number(q.grandTotal) || subtotal - discountTotal + laborTotal + feeTotal + tax;

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

      <div className="header">
        <div>
          <h1 style={{ fontSize: "20pt", margin: 0 }}>Chiefs Pursuit Surplus</h1>
          <div className="meta">Quote / Estimate</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "14pt", fontWeight: "bold" }}>
            {q.quoteNumber ?? q.id.slice(0, 8)}
          </div>
          <div className="meta">Status: {q.status}</div>
          <div className="meta">
            Issued: {new Date(q.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "16pt" }}>
        <div style={{ fontSize: "10pt", color: "#666", textTransform: "uppercase", letterSpacing: "0.5pt" }}>
          Bill to
        </div>
        <div style={{ fontWeight: "bold", marginTop: "2pt" }}>
          {customer?.name ?? "—"}
        </div>
        {customer?.address ? <div>{customer.address}</div> : null}
        {customer?.email ? <div>{customer.email}</div> : null}
        {customer?.phone ? <div>{customer.phone}</div> : null}
      </div>

      {(() => {
        const vehLabel = [q.vehicleYear, q.vehicleMake, q.vehicleModel, q.vehicleTrim]
          .filter(Boolean)
          .join(" ");
        if (!vehLabel && !q.vin && !q.unitNumber) return null;
        return (
          <div style={{ marginBottom: "16pt" }}>
            <div style={{ fontSize: "10pt", color: "#666", textTransform: "uppercase", letterSpacing: "0.5pt" }}>
              Vehicle
            </div>
            {vehLabel ? <div style={{ fontWeight: "bold", marginTop: "2pt" }}>{vehLabel}</div> : null}
            {q.vin ? <div>VIN: {q.vin}</div> : null}
            {q.unitNumber ? <div>Unit #: {q.unitNumber}</div> : null}
          </div>
        );
      })()}

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
                    <PrintKindSections lines={gl} showTitles={false} />
                  </div>
                );
              })}
              {loose.length > 0 ? <PrintKindSections lines={loose} showTitles={true} /> : null}
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
