import { Document, Page, Text, View } from "@react-pdf/renderer";
import React from "react";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";

export type POLine = {
  partId?: string;
  sku?: string | null;
  description: string;
  quantity: number;
  quantityReceived: number;
  unitCost: number;
};

export type PurchaseOrderData = {
  id: string;
  poNumber: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorEmail: string | null;
  vendorPhone: string | null;
  status: string;
  total: number;
  expectedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  notes: string | null;
  lineItems: POLine[];
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function PurchaseOrderDocument({ data }: { data: PurchaseOrderData }) {
  const styles = sharedStyles;
  const generated = new Date();
  const docNumber = data.poNumber ?? `PO-${data.id.slice(0, 8)}`;

  return (
    <Document title={`PURCHASE ORDER ${docNumber}`} author={BRANDING.companyName} creator={BRANDING.companyName}>
      <Page size="LETTER" style={styles.page}>
        {data.status === "received" && <Text style={styles.watermark}>RECEIVED</Text>}

        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{BRANDING.companyName}</Text>
            {BRANDING.tagline ? <Text style={styles.brandLine}>{BRANDING.tagline}</Text> : null}
            {BRANDING.address ? <Text style={styles.brandLine}>{BRANDING.address}</Text> : null}
            {BRANDING.phone ? <Text style={styles.brandLine}>{BRANDING.phone}</Text> : null}
            {BRANDING.email ? <Text style={styles.brandLine}>{BRANDING.email}</Text> : null}
          </View>
          <View>
            <Text style={styles.docTitle}>PURCHASE ORDER</Text>
            <Text style={styles.docMeta}>#{docNumber}</Text>
            <Text style={styles.docMeta}>PO date: {data.createdAt.toLocaleDateString("en-US")}</Text>
            {data.expectedAt ? (
              <Text style={styles.docMeta}>Expected: {data.expectedAt.toLocaleDateString("en-US")}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>Vendor</Text>
            <Text style={styles.blockValue}>{data.vendorName ?? "—"}</Text>
            {data.vendorAddress ? <Text style={styles.blockLabel}>{data.vendorAddress}</Text> : null}
            {data.vendorEmail ? <Text style={styles.blockLabel}>{data.vendorEmail}</Text> : null}
            {data.vendorPhone ? <Text style={styles.blockLabel}>{data.vendorPhone}</Text> : null}
          </View>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>Status</Text>
            <Text style={styles.blockValue}>{data.status.replace(/_/g, " ")}</Text>
            {data.receivedAt ? (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Received</Text>
                <Text style={styles.blockValue}>{data.receivedAt.toLocaleDateString("en-US")}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "16%" }]}>Part #</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "41%" }]}>Description</Text>
            <Text style={[styles.tableCell, styles.cellRight, { width: "9%" }]}>Qty</Text>
            <Text style={[styles.tableCell, styles.cellRight, { width: "9%" }]}>Recv</Text>
            <Text style={[styles.tableCell, styles.cellRight, { width: "12%" }]}>Unit cost</Text>
            <Text style={[styles.tableCell, styles.cellRight, { width: "13%" }]}>Total</Text>
          </View>
          {data.lineItems.length === 0 ? (
            <View style={styles.tableRowLast}>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "100%", color: "#888" }]}>
                No line items.
              </Text>
            </View>
          ) : (
            data.lineItems.map((l, idx) => {
              const last = idx === data.lineItems.length - 1;
              const lineTotal = (l.quantity || 0) * (l.unitCost || 0);
              return (
                <View key={idx} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "16%" }]}>{l.sku || "—"}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "41%" }]}>{l.description}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "9%" }]}>{l.quantity}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "9%" }]}>{l.quantityReceived}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "12%" }]}>{money(l.unitCost || 0)}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "13%" }]}>{money(lineTotal)}</Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.totals}>
          <View style={styles.grandTotalRow}>
            <Text>Total</Text>
            <Text>{money(data.total)}</Text>
          </View>
        </View>

        {data.notes ? (
          <View>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.blockLabel}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>{BRANDING.companyName} · Purchase order {docNumber} · Generated {generated.toLocaleString("en-US")}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
