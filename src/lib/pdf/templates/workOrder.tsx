import { Document, Page, Text, View } from "@react-pdf/renderer";
import React from "react";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";

// The work-order build sheet is the estimate with all pricing stripped out.
// It mirrors the same source line items (so it always matches the estimate /
// invoice exactly) but the shop floor only sees what they need to pull and
// install: part name, brand, manufacturer part number, and quantity. No unit
// price, discount, tax, fee, or total ever appears here.
export type WorkOrderLine = {
  name: string;
  brand: string | null;
  partNumber: string | null;
  quantity: number;
};

export type WorkOrderData = {
  workOrderId: string;
  woNumber: string | null;
  quoteNumber: string | null;
  createdAt: Date;
  status: string;
  customerName: string | null;
  customerAddress: string | null;
  vehicleSummary: string | null;
  lineItems: WorkOrderLine[];
  notes: string | null;
};

export function WorkOrderDocument({ data }: { data: WorkOrderData }) {
  const styles = sharedStyles;
  const generated = new Date();
  const docNumber = data.woNumber ?? `WO-${data.workOrderId.slice(0, 8)}`;

  return (
    <Document
      title={`WORK ORDER ${docNumber}`}
      author={BRANDING.companyName}
      creator={BRANDING.companyName}
      producer={BRANDING.companyName}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{BRANDING.companyName}</Text>
            {BRANDING.tagline ? <Text style={styles.brandLine}>{BRANDING.tagline}</Text> : null}
            {BRANDING.address ? <Text style={styles.brandLine}>{BRANDING.address}</Text> : null}
            {BRANDING.phone ? <Text style={styles.brandLine}>{BRANDING.phone}</Text> : null}
            {BRANDING.email ? <Text style={styles.brandLine}>{BRANDING.email}</Text> : null}
          </View>
          <View>
            <Text style={styles.docTitle}>WORK ORDER</Text>
            <Text style={styles.docMeta}>#{docNumber}</Text>
            <Text style={styles.docMeta}>Date: {data.createdAt.toLocaleDateString("en-US")}</Text>
            {data.quoteNumber ? <Text style={styles.docMeta}>Estimate: {data.quoteNumber}</Text> : null}
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>Customer</Text>
            <Text style={styles.blockValue}>{data.customerName ?? "—"}</Text>
            {data.customerAddress ? <Text style={styles.blockLabel}>{data.customerAddress}</Text> : null}
          </View>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>Vehicle</Text>
            <Text style={styles.blockValue}>{data.vehicleSummary ?? "—"}</Text>
            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Status</Text>
            <Text style={styles.blockValue}>{data.status.replace(/_/g, " ")}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "45%" }]}>Part</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "25%" }]}>Brand</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "20%" }]}>Part #</Text>
            <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>Qty</Text>
          </View>
          {data.lineItems.length === 0 ? (
            <View style={styles.tableRowLast}>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "100%", color: "#888" }]}>
                No parts on this work order.
              </Text>
            </View>
          ) : (
            data.lineItems.map((l, idx) => {
              const last = idx === data.lineItems.length - 1;
              return (
                <View key={idx} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "45%" }]}>{l.name}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "25%" }]}>{l.brand ?? "—"}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "20%" }]}>{l.partNumber ?? "—"}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>{l.quantity}</Text>
                </View>
              );
            })
          )}
        </View>

        {data.notes ? (
          <View>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.blockLabel}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {BRANDING.companyName} · Work order {docNumber} · Generated {generated.toLocaleString("en-US")}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
