import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import React from "react";
import { sharedStyles } from "../styles";
import { BRANDING, brandLogo } from "../branding";
import { quoteTotals, lineNet, lineGross, lineDiscount, round2 } from "@/lib/quoteTotals";
import { lineUnitCost, lineExtCost, costRollup, type PartCostMap } from "@/lib/lineCost";

type LineGroup = { groupId?: string; groupTitle?: string };

export type QuoteLine =
  | ({
      kind: "item";
      description: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      discountKind: "pct" | "amt";
      /** Allocated from a package/promo bundle price; discounts on top of it. */
      bundleDiscount?: number;
      partId?: string;
    } & LineGroup)
  | ({ kind: "fee"; description: string; amount: number; fixed: boolean } & LineGroup)
  | ({ kind: "labor"; description: string; hours: number; rate: number } & LineGroup);

export type QuoteData = {
  quoteNumber: string | null;
  quoteId: string;
  createdAt: Date;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  vehicleSummary: string | null;
  vin: string | null;
  unitNumber: string | null;
  vehicleColor: string | null;
  vehicleMileage: number | null;
  /** Assigned sales person, printed in the header. */
  salesPerson: string | null;
  /** partId → customer-facing part number (`parts.sku`), for the Part # column. */
  partNumbers: Record<string, string>;
  /**
   * partId → internal weighted-average cost. Only read when `internal` is set;
   * the customer-facing document never renders it.
   */
  partCosts: PartCostMap;
  /**
   * INTERNAL COPY: adds per-line cost and margin columns for the sales team.
   * Never true for a document sent to a customer — the route only sets it when
   * `?internal=1` is asked for by a signed-in user.
   */
  internal?: boolean;
  lineItems: QuoteLine[];
  taxTotal: number;
  grandTotal: number;
  notes: string | null;
  status: string;
  // Variant: "quote" = customer-facing estimate, "invoice" = post-conversion
  // invoice (same data, different title + footer wording).
  variant: "quote" | "invoice";
};

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The discount on a line, as the percentage off its own list value.
 *
 * Printed rather than the dollar figure because that is what gets checked
 * against a contract or a promo sheet ("we were quoted 22% off list"). It is
 * derived from the money actually coming off — `lineDiscount` already accounts
 * for a percentage discount, a flat dollar discount, and a package's bundle
 * allocation — so a bundled promo line shows a real percentage instead of a
 * blank where its stored `discount` field happens to be zero.
 */
function discountPct(l: Extract<QuoteLine, { kind: "item" }>): number {
  const gross = lineGross(l);
  if (gross <= 0) return 0;
  return round2((lineDiscount(l) / gross) * 100);
}

/**
 * Wrap a long part number across lines WITHOUT altering it.
 *
 * React-PDF's hyphenation inserts a hyphen at every break, which would turn
 * `KIT-23S1-CC0713-OS` into `KIT-23S1--CC0713-OS` — a part number a customer
 * could order against, silently wrong. So the cell renders its own lines,
 * broken after separators the code already contains. Read top to bottom the
 * pieces concatenate back to exactly the original string.
 *
 * Short codes come back as a single line, unchanged.
 */
function splitCode(code: string, maxLen = 12): string[] {
  if (code.length <= maxLen) return [code];
  // Break points come after a separator, so the separator stays on the line it
  // belongs to and nothing is inserted.
  const atoms = code.split(/(?<=[-_/.])/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const a of atoms) {
    if (cur && (cur + a).length > maxLen) {
      out.push(cur);
      cur = a;
    } else {
      cur += a;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Renders the Parts / Labor / Fees sub-tables for a set of lines. Used
// both for a package group's lines (showTitles=false — the package
// title is the header) and for loose lines (showTitles=true).
function KindTables({
  lines,
  showTitles,
  partNumbers,
  partCosts,
  internal = false,
}: {
  lines: QuoteLine[];
  showTitles: boolean;
  /** partId → customer-facing part number, for the Part # column. */
  partNumbers?: Record<string, string>;
  /** Internal cost basis; only read when `internal`. */
  partCosts?: PartCostMap;
  /** Adds the Cost and Margin columns. Internal copy only. */
  internal?: boolean;
}) {
  const styles = sharedStyles;
  const items = lines.filter((l) => l.kind === "item");
  const labor = lines.filter((l) => l.kind === "labor");
  const fees = lines.filter((l) => l.kind === "fee");
  // Two extra columns on the internal copy, so every column narrows to fit.
  // Each set sums to 100%.
  const W = internal
    ? { num: "3%", desc: "24%", part: "16%", qty: "5%", cost: "11%", unit: "12%", disc: "8%", margin: "11%", total: "10%" }
    : { num: "4%", desc: "40%", part: "16%", qty: "7%", cost: "0%", unit: "13%", disc: "8%", margin: "0%", total: "12%" };
  return (
    <View>
      {items.length > 0 && (
        <View style={{ marginTop: showTitles ? 12 : 4 }} wrap={items.length > 12}>
          {showTitles && (
            <Text style={styles.sectionTitle} minPresenceAhead={70}>
              Parts &amp; Items
            </Text>
          )}
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]} minPresenceAhead={40}>
              <Text style={[styles.tableCell, styles.cellLeft, { width: W.num }]}>#</Text>
              <Text style={[styles.tableCell, styles.cellLeft, { width: W.desc }]}>Description</Text>
              <Text style={[styles.tableCell, styles.cellLeft, { width: W.part }]}>Part #</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: W.qty }]}>Qty</Text>
              {internal ? (
                <Text style={[styles.tableCell, styles.cellRight, { width: W.cost }]}>Avg cost</Text>
              ) : null}
              <Text style={[styles.tableCell, styles.cellRight, { width: W.unit }]}>Unit price</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: W.disc }]}>Disc %</Text>
              {internal ? (
                <Text style={[styles.tableCell, styles.cellRight, { width: W.margin }]}>Margin</Text>
              ) : null}
              <Text style={[styles.tableCell, styles.cellRight, { width: W.total }]}>Total</Text>
            </View>
            {items.map((l, idx) => {
              if (l.kind !== "item") return null;
              const last = idx === items.length - 1;
              // Via the shared money module, not recomputed here: this line
              // used to do its own discount arithmetic, which ignored the
              // bundle/promo allocation entirely and printed a total that
              // disagreed with the editor and the saved grand total.
              const gross = lineGross(l);
              const disc = lineDiscount(l);
              const pct = discountPct(l);
              const partNo = l.partId ? partNumbers?.[l.partId] : undefined;
              const unitCost = internal ? lineUnitCost(l, partCosts ?? {}) : null;
              const extCost = internal ? lineExtCost(l, partCosts ?? {}) : null;
              const net = lineNet(l);
              const lineMargin = extCost == null ? null : round2(net - extCost);
              const marginPct = lineMargin == null || net <= 0 ? null : (lineMargin / net) * 100;
              return (
                <View key={`item-${idx}`} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: W.num }]}>{idx + 1}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: W.desc }]}>{l.description}</Text>
                  <View style={{ width: W.part, paddingVertical: 6, paddingHorizontal: 8 }}>
                    {(partNo ? splitCode(partNo, internal ? 11 : 14) : ["—"]).map((piece, k) => (
                      <Text key={k} style={{ fontSize: 8.5, textAlign: "left" }}>
                        {piece}
                      </Text>
                    ))}
                  </View>
                  <Text style={[styles.tableCell, styles.cellRight, { width: W.qty }]}>{l.quantity}</Text>
                  {internal ? (
                    // "—" rather than $0.00: a part with no recorded average is
                    // not a free part, and a rep must be able to tell.
                    <Text style={[styles.tableCell, styles.cellRight, { width: W.cost, fontSize: 9 }]}>
                      {unitCost == null ? "—" : money(unitCost)}
                    </Text>
                  ) : null}
                  <Text style={[styles.tableCell, styles.cellRight, { width: W.unit }]}>{money(l.unitPrice || 0)}</Text>
                  {/* The percentage off list, which is what gets checked against
                      a contract. The dollars come off in the Total column. */}
                  <Text style={[styles.tableCell, styles.cellRight, { width: W.disc }]}>
                    {pct > 0 ? `${pct.toFixed(2)}%` : "—"}
                  </Text>
                  {internal ? (
                    <Text style={[styles.tableCell, styles.cellRight, { width: W.margin, fontSize: 9 }]}>
                      {lineMargin == null
                        ? "—"
                        : `${money(lineMargin)}${marginPct == null ? "" : ` / ${marginPct.toFixed(0)}%`}`}
                    </Text>
                  ) : null}
                  {disc > 0 ? (
                    // Show the pre-discount price struck through above the
                    // discounted price so the customer sees the saving per line.
                    <View style={{ width: W.total, paddingVertical: 6, paddingHorizontal: 8 }}>
                      <Text style={{ fontSize: 8, textAlign: "right", color: "#888888", textDecoration: "line-through" }}>
                        {money(gross)}
                      </Text>
                      <Text style={{ fontSize: 10, textAlign: "right" }}>{money(lineNet(l))}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.tableCell, styles.cellRight, { width: W.total }]}>{money(lineNet(l))}</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}
      {labor.length > 0 && (
        <View style={{ marginTop: showTitles ? 12 : 4 }} wrap={labor.length > 12}>
          {showTitles && (
            <Text style={styles.sectionTitle} minPresenceAhead={70}>
              Labor
            </Text>
          )}
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]} minPresenceAhead={40}>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "55%" }]}>Description</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>Hours</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>Rate / hr</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>Total</Text>
            </View>
            {labor.map((l, idx) => {
              if (l.kind !== "labor") return null;
              const last = idx === labor.length - 1;
              const total = (l.hours || 0) * (l.rate || 0);
              return (
                <View key={`labor-${idx}`} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "55%" }]}>{l.description}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>{l.hours || 0}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>{money(l.rate || 0)}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>{money(total)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
      {fees.length > 0 && (
        <View style={{ marginTop: showTitles ? 12 : 4 }} wrap={fees.length > 12}>
          {showTitles && (
            <Text style={styles.sectionTitle} minPresenceAhead={70}>
              Fees &amp; Add-ons
            </Text>
          )}
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]} minPresenceAhead={40}>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "75%" }]}>Description</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "25%" }]}>Amount</Text>
            </View>
            {fees.map((l, idx) => {
              if (l.kind !== "fee") return null;
              const last = idx === fees.length - 1;
              return (
                <View key={`fee-${idx}`} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "75%" }]}>
                    {l.description} {l.fixed ? "(fixed fee)" : "(custom fee)"}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "25%" }]}>{money(l.amount || 0)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

export function QuoteDocument({ data }: { data: QuoteData }) {
  const styles = sharedStyles;
  // Round each line before summing (shared helper) so the rows foot to grand.
  const t = quoteTotals(data.lineItems, 0);
  const subtotal = t.subtotal;
  const discountTotal = t.discountTotal;
  const feeTotal = t.feeTotal;
  const laborTotal = t.laborTotal;
  // Grand derived from the same rounded components + the stored tax, so the
  // printed rows always add up to the total (independent of any stale stored grand).
  const grand = round2(subtotal - discountTotal + feeTotal + laborTotal + (data.taxTotal || 0));

  const isInvoice = data.variant === "invoice";
  const docTitle = isInvoice ? "INVOICE" : "QUOTE";
  const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
  const dateLabel = isInvoice ? "Invoice date" : "Quote date";
  const generated = new Date();
  const logo = brandLogo();
  const isInternal = data.internal === true;

  return (
    <Document
      title={`${docTitle} ${docNumber}${isInternal ? " (internal copy)" : ""}`}
      author={BRANDING.companyName}
      creator={BRANDING.companyName}
      producer={BRANDING.companyName}
    >
      <Page size="LETTER" style={styles.pageWithRunningHeader}>
        {data.status === "draft" && !isInvoice && <Text style={styles.watermark}>DRAFT</Text>}

        {/* Masthead, repeated on every page: logo + company block on the left,
            document number and the assigned sales person on the right. */}
        <View style={styles.runningHeader} fixed>
          <View style={styles.brandBlock}>
            {logo ? (
              <Image src={logo} style={styles.logo} />
            ) : (
              // No logo file installed yet — set the company name as a wordmark
              // rather than leaving a blank corner. See `brandLogo()`.
              <Text style={styles.logoWordmark}>{BRANDING.companyName}</Text>
            )}
            {BRANDING.address ? <Text style={styles.brandLine}>{BRANDING.address}</Text> : null}
            {BRANDING.phone ? <Text style={styles.brandLine}>{BRANDING.phone}</Text> : null}
            {BRANDING.email ? <Text style={styles.brandLine}>{BRANDING.email}</Text> : null}
            {BRANDING.website ? <Text style={styles.brandLine}>{BRANDING.website}</Text> : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docTitle}>{docTitle}</Text>
            <Text style={styles.docMeta}>#{docNumber}</Text>
            <Text style={styles.docMeta}>
              {dateLabel}: {data.createdAt.toLocaleDateString("en-US")}
            </Text>
            {data.salesPerson ? (
              <Text style={styles.docRep}>Sales rep: {data.salesPerson}</Text>
            ) : null}
          </View>
        </View>

        {isInternal ? (
          <View style={styles.internalBanner} fixed>
            <Text>INTERNAL COPY — shows our cost and margin. Do not send to the customer.</Text>
          </View>
        ) : null}

        <View style={styles.twoCol}>
          <View style={{ width: "48%" }}>
            <Text style={[styles.sectionTitle, { marginTop: 0 }]}>
              {isInvoice ? "Bill to" : "Prepared for"}
            </Text>
            <Text style={styles.blockValue}>{data.customerName ?? "—"}</Text>
            {data.customerAddress ? <Text style={styles.blockLabel}>{data.customerAddress}</Text> : null}
            {data.customerPhone ? <Text style={styles.blockLabel}>{data.customerPhone}</Text> : null}
            {data.customerEmail ? <Text style={styles.blockLabel}>{data.customerEmail}</Text> : null}
          </View>
          <View style={{ width: "48%" }}>
            {/* The vehicle this build is for. Engine and transmission are not
                shown because the app does not record them — a blank line beats
                an invented one on a document a customer signs. */}
            <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Vehicle</Text>
            <Text style={styles.blockValue}>{data.vehicleSummary ?? "—"}</Text>
            {data.vin ? <Text style={styles.blockLabel}>VIN: {data.vin}</Text> : null}
            {data.unitNumber ? <Text style={styles.blockLabel}>Unit #: {data.unitNumber}</Text> : null}
            {data.vehicleColor ? <Text style={styles.blockLabel}>Color: {data.vehicleColor}</Text> : null}
            {data.vehicleMileage != null ? (
              <Text style={styles.blockLabel}>
                Mileage: {data.vehicleMileage.toLocaleString("en-US")}
              </Text>
            ) : null}
            <Text style={[styles.blockLabel, { marginTop: 4 }]}>
              Status: {data.status.replace(/_/g, " ")}
            </Text>
          </View>
        </View>

        {/* Package groups render first as titled sections (matching the
            saved package's name), then any loose/ungrouped lines fall
            into the standard Parts / Labor / Fees sections. */}
        {(() => {
          if (data.lineItems.length === 0) {
            return (
              <View style={[styles.table, { marginTop: 12 }]}>
                <View style={styles.tableRowLast}>
                  <Text
                    style={[styles.tableCell, styles.cellLeft, { width: "100%", color: "#888" }]}
                  >
                    No line items.
                  </Text>
                </View>
              </View>
            );
          }

          const groupOrder: string[] = [];
          const groupMap = new Map<string, QuoteLine[]>();
          const loose: QuoteLine[] = [];
          for (const l of data.lineItems) {
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
            <View>
              {groupOrder.map((gid) => {
                const gl = groupMap.get(gid)!;
                const title = gl[0]?.groupTitle ?? "Package";
                return (
                  <View key={gid} style={{ marginTop: 14 }}>
                    <View
                      minPresenceAhead={80}
                      style={{
                        backgroundColor: "#f3f4f6",
                        borderWidth: 1,
                        borderColor: "#000000",
                        paddingVertical: 4,
                        paddingHorizontal: 8,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: 700 }}>{title}</Text>
                    </View>
                    <KindTables lines={gl} showTitles={false} partNumbers={data.partNumbers} partCosts={data.partCosts} internal={isInternal} />
                  </View>
                );
              })}
              {loose.length > 0 && <KindTables lines={loose} showTitles={true} partNumbers={data.partNumbers} partCosts={data.partCosts} internal={isInternal} />}
            </View>
          );
        })()}

        {/* `wrap={false}` keeps the totals on one page. Without it a page break
            landed between "Subtotal" and "Amount due", which is the last thing
            you want split on an invoice. */}
        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(subtotal)}</Text>
          </View>
          {discountTotal > 0 && (
            <View style={styles.totalRow}>
              <Text>Discount</Text>
              <Text>-{money(discountTotal)}</Text>
            </View>
          )}
          {laborTotal > 0 && (
            <View style={styles.totalRow}>
              <Text>Labor</Text>
              <Text>{money(laborTotal)}</Text>
            </View>
          )}
          {feeTotal > 0 && (
            <View style={styles.totalRow}>
              <Text>Fees</Text>
              <Text>{money(feeTotal)}</Text>
            </View>
          )}
          {data.taxTotal > 0 && (
            <View style={styles.totalRow}>
              <Text>Tax</Text>
              <Text>{money(data.taxTotal)}</Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text>{isInvoice ? "Amount due" : "Total"}</Text>
            <Text>{money(grand)}</Text>
          </View>
          {isInternal
            ? (() => {
                // Margin against parts net only: labor and fees have no part
                // cost to compare against, and folding them in would flatter
                // the number a rep negotiates on.
                const partsNet = round2(subtotal - discountTotal);
                const roll = costRollup(data.lineItems, partsNet, data.partCosts ?? {});
                return (
                  <View style={styles.internalTotals}>
                    <View style={styles.totalRow}>
                      <Text>Parts cost (avg)</Text>
                      <Text>{money(roll.cost)}</Text>
                    </View>
                    <View style={styles.totalRow}>
                      <Text>Parts margin</Text>
                      <Text>
                        {money(roll.margin)}
                        {roll.marginPct != null ? ` (${roll.marginPct.toFixed(1)}%)` : ""}
                      </Text>
                    </View>
                    {roll.unknown > 0 ? (
                      <Text style={{ fontSize: 8, color: BRANDING.mutedColor, marginTop: 2 }}>
                        {roll.unknown} line{roll.unknown === 1 ? "" : "s"} without a recorded average cost -
                        excluded above.
                      </Text>
                    ) : null}
                  </View>
                );
              })()
            : null}
        </View>

        {data.notes ? (
          <View>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.blockLabel}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {BRANDING.companyName} · {isInvoice ? "Invoice" : "Quote"} {docNumber}
            {isInternal ? " · INTERNAL COPY" : ""} · Generated {generated.toLocaleString("en-US")}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
