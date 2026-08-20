import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import React from "react";
import { sharedStyles } from "../styles";
import { BRANDING, brandLogo } from "../branding";
import { quoteTotals, lineNet, lineGross, lineDiscount, round2 } from "@/lib/quoteTotals";

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

// Renders the Parts / Labor / Fees sub-tables for a set of lines. Used
// both for a package group's lines (showTitles=false — the package
// title is the header) and for loose lines (showTitles=true).
function KindTables({
  lines,
  showTitles,
  partNumbers,
}: {
  lines: QuoteLine[];
  showTitles: boolean;
  /** partId → customer-facing part number, for the Part # column. */
  partNumbers?: Record<string, string>;
}) {
  const styles = sharedStyles;
  const items = lines.filter((l) => l.kind === "item");
  const labor = lines.filter((l) => l.kind === "labor");
  const fees = lines.filter((l) => l.kind === "fee");
  return (
    <View>
      {items.length > 0 && (
        <View style={{ marginTop: showTitles ? 12 : 4 }}>
          {showTitles && <Text style={styles.sectionTitle}>Parts &amp; Items</Text>}
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "4%" }]}>#</Text>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "40%" }]}>Description</Text>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "16%" }]}>Part #</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "7%" }]}>Qty</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "13%" }]}>Unit price</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "8%" }]}>Disc %</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "12%" }]}>Total</Text>
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
              return (
                <View key={`item-${idx}`} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "4%" }]}>{idx + 1}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "40%" }]}>{l.description}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "16%", fontSize: 9 }]}>
                    {partNo ?? "—"}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "7%" }]}>{l.quantity}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "13%" }]}>{money(l.unitPrice || 0)}</Text>
                  {/* The percentage off list, which is what gets checked against
                      a contract. The dollars come off in the Total column. */}
                  <Text style={[styles.tableCell, styles.cellRight, { width: "8%" }]}>
                    {pct > 0 ? `${pct.toFixed(2)}%` : "—"}
                  </Text>
                  {disc > 0 ? (
                    // Show the pre-discount price struck through above the
                    // discounted price so the customer sees the saving per line.
                    <View style={{ width: "12%", paddingVertical: 6, paddingHorizontal: 8 }}>
                      <Text style={{ fontSize: 8, textAlign: "right", color: "#888888", textDecoration: "line-through" }}>
                        {money(gross)}
                      </Text>
                      <Text style={{ fontSize: 10, textAlign: "right" }}>{money(lineNet(l))}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.tableCell, styles.cellRight, { width: "12%" }]}>{money(lineNet(l))}</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}
      {labor.length > 0 && (
        <View style={{ marginTop: showTitles ? 12 : 4 }}>
          {showTitles && <Text style={styles.sectionTitle}>Labor</Text>}
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
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
        <View style={{ marginTop: showTitles ? 12 : 4 }}>
          {showTitles && <Text style={styles.sectionTitle}>Fees &amp; Add-ons</Text>}
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
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

  return (
    <Document
      title={`${docTitle} ${docNumber}`}
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
            {logo ? <Text style={styles.brandLine}>{BRANDING.companyName}</Text> : null}
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
                    <KindTables lines={gl} showTitles={false} partNumbers={data.partNumbers} />
                  </View>
                );
              })}
              {loose.length > 0 && <KindTables lines={loose} showTitles={true} partNumbers={data.partNumbers} />}
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
        </View>

        {data.notes ? (
          <View>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.blockLabel}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {BRANDING.companyName} · {isInvoice ? "Invoice" : "Quote"} {docNumber} · Generated {generated.toLocaleString("en-US")}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
