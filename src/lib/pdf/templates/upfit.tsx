import { Document, Page, Text, View, Image as PdfImage } from "@react-pdf/renderer";
import React from "react";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";
import {
  getColorScheme,
  getPinSize,
  getTemplate,
  localImagePath,
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

// React-PDF embeds images by bytes, not URL — so we read the template
// off disk at render time. Returns null when the file isn't present yet
// (user hasn't uploaded that template image); the diagram then renders
// as an empty labeled box.
//
// process.cwd() resolves to different roots in dev (the repo) vs Vercel
// serverless (/var/task), and Next's file tracer may strip the `public`
// prefix, so we probe a few candidate locations rather than assuming.
function loadTemplateImage(imageUrl: string): Buffer | null {
  const local = localImagePath(imageUrl);
  if (!local) return null;
  const trimmed = local.replace(/^public\//, "");
  const candidates = [
    path.join(process.cwd(), local),
    path.join(process.cwd(), trimmed),
    path.join(process.cwd(), ".next", "server", local),
    path.join(process.cwd(), ".next", "server", trimmed),
  ];
  for (const abs of candidates) {
    if (existsSync(abs)) {
      try {
        return readFileSync(abs);
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

// PANEL_W is the page content width (Letter minus the 48pt horizontal
// padding from sharedStyles.page). Pin sizes are stored as fractions of
// the diagram's dimensions and applied as actual points off PANEL_W
// (assuming roughly the rendered vehicle aspect) so the printed pin
// looks like the on-screen editor pin.
const PANEL_W = 612 - 96;
// Most of our vehicle templates render at roughly 2:1 (wide and short).
// Used to convert heightFrac → points; this is approximate but the only
// alternative is to inspect every image and embed its true aspect.
const ASSUMED_PANEL_H = PANEL_W * 0.5;

function pinDims(pin: UpfitPin) {
  const sz = getPinSize(pin.size);
  const longPt = sz.widthFrac * PANEL_W;
  const shortPt = sz.heightFrac * ASSUMED_PANEL_H;
  const horizontal = (pin.orientation ?? "horizontal") === "horizontal";
  return {
    width: horizontal ? longPt : shortPt,
    height: horizontal ? shortPt : longPt,
    horizontal,
  };
}

function PinShape({ pin }: { pin: UpfitPin }) {
  const scheme = getColorScheme(pin.colorScheme);
  const { width, height, horizontal } = pinDims(pin);
  return (
    <View
      style={{
        position: "absolute",
        left: `${pin.x * 100}%`,
        top: `${pin.y * 100}%`,
        width,
        height,
        marginLeft: -width / 2,
        marginTop: -height / 2,
        borderWidth: 0.6,
        borderColor: "#000000",
        flexDirection: horizontal ? "row" : "column",
      }}
    >
      {scheme.segments.map((c, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: c }} />
      ))}
      {/* Number badge — small black dot in the top-left corner so techs
          can still cross-reference the equipment table. */}
      <View
        style={{
          position: "absolute",
          top: -5,
          left: -5,
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: "#000000",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 6, fontWeight: 700, color: "#ffffff" }}>
          {String(pin.number)}
        </Text>
      </View>
      {/* Caption pill rendered below the rectangle. */}
      {pin.caption ? (
        <View
          style={{
            position: "absolute",
            top: height + 1,
            left: 0,
            alignItems: "center",
            width: "100%",
          }}
        >
          <View
            style={{
              backgroundColor: "#ffffff",
              borderWidth: 0.4,
              borderColor: "#000000",
              paddingHorizontal: 2,
              paddingVertical: 0.5,
            }}
          >
            <Text style={{ fontSize: 5.5, fontWeight: 700, color: "#000000" }}>
              {pin.caption}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

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
          {data.pins.map((pin) => (
            <PinShape key={pin.id} pin={pin} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>Equipment &amp; placement</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "6%" }]}>#</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "38%" }]}>Equipment</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "13%" }]}>SKU</Text>
            <Text style={[styles.tableCell, styles.cellLeft, { width: "21%" }]}>Caption</Text>
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
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "6%", fontWeight: 700 }]}>
                    {pin.number}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "38%" }]}>{pin.label}</Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "13%" }]}>
                    {pin.partSku ?? "—"}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "21%" }]}>
                    {pin.caption ?? ""}
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
