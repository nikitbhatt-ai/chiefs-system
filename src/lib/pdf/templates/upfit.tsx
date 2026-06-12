import { Document, Page, Text, View, Svg, Path, Circle, G, Image as PdfImage } from "@react-pdf/renderer";
import React from "react";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";
import {
  VIEW_LABELS,
  VIEW_ORDER,
  VIEW_VIEWBOX,
  getTemplate,
  localImagePath,
  type ViewKey,
} from "@/lib/upfit/templates";
import type { UpfitPin } from "@/db/schema";

// React-PDF embeds images by bytes, not URL — so we read the template
// off disk at render time. Returns null when the file isn't present yet
// (user hasn't uploaded that template image); the PDF then falls back to
// drawing the SVG fallback paths in its place.
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

// Render one diagram view. Pins are scaled into the SVG's own coordinate
// space (1000x600), so the relative positions match the on-screen editor
// without any conversion.
function ViewPanel({
  view,
  imageBuffer,
  fallbackPaths,
  pins,
  vehicleLabel,
}: {
  view: ViewKey;
  imageBuffer: Buffer | null;
  fallbackPaths: string[];
  pins: UpfitPin[];
  vehicleLabel: string;
}) {
  // PANEL_H scales the SVG viewBox onto the page. The image fills the
  // SVG via an absolute-positioned PdfImage when present; pins stay in
  // the SVG layer so coordinates match the editor exactly.
  const PANEL_H = 140;
  return (
    <View style={{ width: "48%", marginBottom: 12, padding: 6, borderWidth: 1, borderColor: "#cccccc" }}>
      <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 1 }}>{vehicleLabel}</Text>
      <Text style={{ fontSize: 8, color: BRANDING.mutedColor, marginBottom: 4, textTransform: "uppercase" }}>
        {VIEW_LABELS[view]}
      </Text>
      <View style={{ position: "relative", width: "100%", height: PANEL_H }}>
        {imageBuffer ? (
          <PdfImage
            src={imageBuffer}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: PANEL_H, objectFit: "contain" }}
          />
        ) : null}
        <Svg
          viewBox={`0 0 ${VIEW_VIEWBOX.width} ${VIEW_VIEWBOX.height}`}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: PANEL_H }}
        >
          {/* Fallback line-art renders only when the image is missing. */}
          {!imageBuffer ? (
            <G stroke="#222222" strokeWidth={3} fill="none">
              {fallbackPaths.map((d, i) => (
                <Path key={i} d={d} />
              ))}
            </G>
          ) : null}
          {pins.map((pin) => {
            const cx = pin.x * VIEW_VIEWBOX.width;
            const cy = pin.y * VIEW_VIEWBOX.height;
            return (
              <G key={pin.id}>
                <Circle cx={cx} cy={cy} r={28} fill={pin.color ?? "#f59e0b"} stroke="#000000" strokeWidth={3} />
                <Text
                  x={cx}
                  y={cy + 10}
                  style={
                    {
                      fontSize: 28,
                      fontWeight: 700,
                      textAnchor: "middle",
                      fill: "#000000",
                    } as Record<string, unknown>
                  }
                >
                  {String(pin.number)}
                </Text>
              </G>
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

export function UpfitDocument({ data }: { data: UpfitPdfData }) {
  const styles = sharedStyles;
  const template = getTemplate(data.bodyStyle);
  const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
  const vehicleLabel = data.vehicleSummary ?? template.label;
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
            <Text style={styles.blockValue}>{data.vehicleSummary ?? template.label}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Placement diagram</Text>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          {VIEW_ORDER.map((view) => {
            const v = template.views[view];
            return (
              <ViewPanel
                key={view}
                view={view}
                imageBuffer={loadTemplateImage(v.imageUrl)}
                fallbackPaths={v.fallbackPaths}
                pins={data.pins.filter((p) => p.view === view)}
                vehicleLabel={vehicleLabel}
              />
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Equipment & placement</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "8%" }]}>#</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "42%" }]}>Equipment</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "12%" }]}>SKU</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "16%" }]}>View</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "22%" }]}>Placement note</Text>
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
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "42%" }]}>{pin.label}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "12%" }]}>
                    {pin.partSku ?? "—"}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "16%" }]}>
                    {VIEW_LABELS[pin.view]}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "22%" }]}>
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
