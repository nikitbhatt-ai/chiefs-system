import { Document, Page, Text, View, Image as PdfImage } from "@react-pdf/renderer";
import React from "react";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";
import { getTemplate, localImagePath } from "@/lib/upfit/templates";
import type { UpfitPin } from "@/db/schema";

export type UpfitPdfData = {
  quoteId: string;
  quoteNumber: string | null;
  createdAt: Date;
  customerName: string | null;
  vehicleSummary: string | null;
  bodyStyle: string;
  pins: UpfitPin[];
  notes: string | null;
};

// React-PDF embeds images by bytes, not URL — so we read the template
// off disk at render time. Returns null when the file isn't present yet
// (user hasn't uploaded that template image); the diagram then renders
// as an empty labeled box.
function loadTemplateImage(imageUrl: string): Buffer | null {
  const local = localImagePath(imageUrl);
  if (!local) return null;
  const abs = path.join(process.cwd(), local);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs);
  } catch {
    return null;
  }
}

// The diagram is one composite image with pins overlaid by percentage
// position. PANEL_W is the page content width (Letter minus the 48pt
// horizontal padding from sharedStyles.page). Pin diameter is fixed in
// points; positions are percent of the panel so they line up with the
// editor regardless of the image's native aspect ratio.
const PANEL_W = 612 - 96;
const PIN_D = 16;

export function UpfitDocument({ data }: { data: UpfitPdfData }) {
  const styles = sharedStyles;
  const template = getTemplate(data.bodyStyle);
  const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
  const vehicleLabel = data.vehicleSummary ?? template.label;
  const imageBuffer = loadTemplateImage(template.imageUrl);
  const generated = new Date();

  return (
    <Document
      title={`Upfit spec ${docNumber}`}
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
          </View>
          <View>
            <Text style={styles.docTitle}>UPFIT SPEC</Text>
            <Text style={styles.docMeta}>Quote #{docNumber}</Text>
            <Text style={styles.docMeta}>Date: {data.createdAt.toLocaleDateString("en-US")}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>Customer</Text>
            <Text style={styles.blockValue}>{data.customerName ?? "—"}</Text>
          </View>
          <View style={{ width: "48%" }}>
            <Text style={styles.sectionTitle}>Vehicle</Text>
            <Text style={styles.blockValue}>{vehicleLabel}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Placement diagram</Text>
        <View style={{ position: "relative", width: PANEL_W, marginTop: 4 }}>
          {imageBuffer ? (
            <PdfImage src={imageBuffer} style={{ width: PANEL_W }} />
          ) : (
            <View
              style={{
                width: PANEL_W,
                height: 240,
                borderWidth: 1,
                borderColor: "#cccccc",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 9, color: "#999999" }}>
                Diagram image not uploaded ({template.imageUrl})
              </Text>
            </View>
          )}
          {/* Pins overlaid by percentage so they track the image at any
              aspect ratio. Centered on the point via the -PIN_D/2 offset. */}
          {data.pins.map((pin) => (
            <View
              key={pin.id}
              style={{
                position: "absolute",
                left: `${pin.x * 100}%`,
                top: `${pin.y * 100}%`,
                width: PIN_D,
                height: PIN_D,
                marginLeft: -PIN_D / 2,
                marginTop: -PIN_D / 2,
                borderRadius: PIN_D / 2,
                backgroundColor: pin.color ?? "#f59e0b",
                borderWidth: 1.5,
                borderColor: "#000000",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: 700, color: "#000000" }}>
                {String(pin.number)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Equipment &amp; placement</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "8%" }]}>#</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "52%" }]}>Equipment</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "15%" }]}>SKU</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "25%" }]}>Placement note</Text>
          </View>
          {data.pins.length === 0 ? (
            <View style={styles.tableRowLast}>
              <Text style={[styles.tableCell, styles.cellLeft, { width: "100%", color: "#888" }]}>
                No pins placed yet.
              </Text>
            </View>
          ) : (
            data.pins.map((pin, idx) => {
              const last = idx === data.pins.length - 1;
              return (
                <View key={pin.id} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "8%", fontWeight: 700 }]}>
                    {pin.number}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "52%" }]}>{pin.label}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "15%" }]}>
                    {pin.partSku ?? "—"}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "25%" }]}>
                    {pin.notes ?? ""}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {data.notes ? (
          <View>
            <Text style={styles.sectionTitle}>Build notes</Text>
            <Text style={styles.blockLabel}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {BRANDING.companyName} · Upfit spec {docNumber} · Generated {generated.toLocaleString("en-US")}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
