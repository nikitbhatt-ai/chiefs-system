import { Document, Page, Text, View } from "@react-pdf/renderer";
import React from "react";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";

type LineGroup = { groupId?: string; groupTitle?: string };

export type QuoteLine =
  | ({ kind: "item"; description: string; quantity: number; unitPrice: number; discount: number; discountKind: "pct" | "amt"; partId?: string } & LineGroup)
  | ({ kind: "fee"; description: string; amount: number; fixed: boolean } & LineGroup)
  | ({ kind: "labor"; description: string; hours: number; rate: number } & LineGroup);

export type QuoteData = {
  quoteNumber: string | null;
  quoteId: string;
  createdAt: Date;
  customerName: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
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
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Renders the Parts / Labor / Fees sub-tables for a set of lines. Used
// both for a package group's lines (showTitles=false — the package
// title is the header) and for loose lines (showTitles=true).
function KindTables({ lines, showTitles }: { lines: QuoteLine[]; showTitles: boolean }) {
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
              <Text style={[styles.tableCell, styles.cellLeft, { width: "55%" }]}>Description</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>Qty</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>Unit price</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>Disc</Text>
              <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>Total</Text>
            </View>
            {items.map((l, idx) => {
              if (l.kind !== "item") return null;
              const last = idx === items.length - 1;
              const gross = (l.quantity || 0) * (l.unitPrice || 0);
              const disc = l.discountKind === "pct" ? gross * ((l.discount || 0) / 100) : l.discount || 0;
              return (
                <View key={`item-${idx}`} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "55%" }]}>{l.description}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>{l.quantity}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>{money(l.unitPrice || 0)}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>
                    {l.discountKind === "pct" ? `${l.discount || 0}%` : money(l.discount || 0)}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>{money(gross - disc)}</Text>
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
  let subtotal = 0;
  let discountTotal = 0;
  let feeTotal = 0;
  let laborTotal = 0;
  for (const l of data.lineItems) {
    if (l.kind === "item") {
      const gross = (l.quantity || 0) * (l.unitPrice || 0);
      const disc = l.discountKind === "pct" ? gross * ((l.discount || 0) / 100) : (l.discount || 0);
      subtotal += gross;
      discountTotal += disc;
    } else if (l.kind === "labor") {
      laborTotal += (l.hours || 0) * (l.rate || 0);
    } else {
      feeTotal += l.amount || 0;
    }
  }

  const isInvoice = data.variant === "invoice";
  const docTitle = isInvoice ? "INVOICE" : "QUOTE";
  const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
  const dateLabel = isInvoice ? "Invoice date" : "Quote date";
  const generated = new Date();

  return (
    <Document
      title={`${docTitle} ${docNumber}`}
      author={BRANDING.companyName}
      creator={BRANDING.companyName}
      producer={BRANDING.companyName}
    >
      <Page size="LETTER" style={styles.page}>
        {data.status === "draft" && !isInvoice && <Text style={styles.watermark}>DRAFT</Text>}

        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{BRANDING.companyName}</Text>
            {BRANDING.tagline ? <Text style={styles.brandLine}>{BRANDING.tagline}</Text> : null}
            {BRANDING.address ? <Text style={styles.brandLine}>{BRANDING.address}</Text> : null}
            {BRANDING.phone ? <Text style={styles.brandLine}>{BRANDING.phone}</Text> : null}
            {BRANDING.email ? <Text style={styles.brandLine}>{BRANDING.email}</Text> : null}
          </View>
          <View>
            <Text style={styles.docTitle}>{docTitle}</Text>
            <Text style={styles.docMeta}>#{docNumber}</Text>
            <Text style={styles.docMeta}>{dateLabel}: {data.createdAt.toLocaleDateString("en-US")}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>{isInvoice ? "Bill to" : "Prepared for"}</Text>
            <Text style={styles.blockValue}>{data.customerName ?? "—"}</Text>
            {data.customerEmail ? <Text style={styles.blockLabel}>{data.customerEmail}</Text> : null}
            {data.customerAddress ? <Text style={styles.blockLabel}>{data.customerAddress}</Text> : null}
          </View>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>Status</Text>
            <Text style={styles.blockValue}>{data.status.replace(/_/g, " ")}</Text>
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
                    <KindTables lines={gl} showTitles={false} />
                  </View>
                );
              })}
              {loose.length > 0 && <KindTables lines={loose} showTitles={true} />}
            </View>
          );
        })()}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(subtotal)}</Text>
          </View>
          {discountTotal > 0 && (
            <View style={styles.totalRow}>
              <Text>Discount</Text>
              <Text>−{money(discountTotal)}</Text>
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
            <Text>{money(data.grandTotal)}</Text>
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
