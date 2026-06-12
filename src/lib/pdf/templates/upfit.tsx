import { Document, Page, Text, View, Svg, Path, Circle, G } from "@react-pdf/renderer";
import React from "react";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";
import {
  VIEW_LABELS,
  VIEW_ORDER,
  VIEW_VIEWBOX,
  getTemplate,
  type ViewKey,
} from "@/lib/upfit/templates";
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

// Render one diagram view. Pins are scaled into the SVG's own coordinate
// space (1000x600), so the relative positions match the on-screen editor
// without any conversion.
function ViewPanel({
  view,
  paths,
  pins,
}: {
  view: ViewKey;
  paths: string[];
  pins: UpfitPin[];
}) {
  return (
    <View style={{ width: "48%", marginBottom: 12, padding: 6, borderWidth: 1, borderColor: "#cccccc" }}>
      <Text style={{ fontSize: 8, color: BRANDING.mutedColor, marginBottom: 4, textTransform: "uppercase" }}>
        {VIEW_LABELS[view]}
      </Text>
      <Svg viewBox={`0 0 ${VIEW_VIEWBOX.width} ${VIEW_VIEWBOX.height}`} style={{ width: "100%", height: 140 }}>
        <G stroke="#222222" strokeWidth={3} fill="none">
          {paths.map((d, i) => (
            <Path key={i} d={d} />
          ))}
        </G>
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
  );
}

export function UpfitDocument({ data }: { data: UpfitPdfData }) {
  const styles = sharedStyles;
  const template = getTemplate(data.bodyStyle);
  const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
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
          {VIEW_ORDER.map((view) => (
            <ViewPanel
              key={view}
              view={view}
              paths={template.views[view].paths}
              pins={data.pins.filter((p) => p.view === view)}
            />
          ))}
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
