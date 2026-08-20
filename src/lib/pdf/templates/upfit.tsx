import { Document, Page, Text, View, Image as PdfImage, Svg, Rect } from "@react-pdf/renderer";
import React from "react";
import { lineGross, lineDiscount, lineNet } from "@/lib/quoteTotals";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { sharedStyles } from "../styles";
import { BRANDING } from "../branding";
import {
  getColorScheme,
  getPinSize,
  getTemplate,
  getViews,
  localImagePath,
  PUSHBAR_RECTS,
  PUSHBAR_VIEWBOX,
} from "@/lib/upfit/templates";
import type { QuoteLine } from "./quote";
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
  // The linked quote, rendered on page 2 so the spec sheet carries the
  // priced quote alongside the placement diagram.
  quoteLineItems: QuoteLine[];
  quoteTaxTotal: number;
  quoteGrandTotal: number;
  quoteStatus: string;
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

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
  const isCircle = pin.shape === "circle";
  const horizontal = (pin.orientation ?? "horizontal") === "horizontal";
  const hasOverride =
    pin.widthFracOverride != null && pin.heightFracOverride != null;

  // Circles are a uniform diameter (width fraction).
  if (isCircle) {
    const d = (pin.widthFracOverride ?? sz.widthFrac) * PANEL_W;
    return { width: d, height: d, horizontal, isCircle };
  }

  // A drag-resize override is stored as LITERAL width/height fractions
  // (screen-x → width, screen-y → height), so use them directly — this
  // is what makes vertical pins resize the same way horizontal ones do.
  if (hasOverride) {
    return {
      width: (pin.widthFracOverride as number) * PANEL_W,
      height: (pin.heightFracOverride as number) * ASSUMED_PANEL_H,
      horizontal,
      isCircle,
    };
  }

  // No override: preset fractions, swapping long/short for vertical.
  const longPt = sz.widthFrac * PANEL_W;
  const shortPt = sz.heightFrac * ASSUMED_PANEL_H;
  return {
    width: horizontal ? longPt : shortPt,
    height: horizontal ? shortPt : longPt,
    horizontal,
    isCircle,
  };
}

function CaptionPill({ caption, height }: { caption: string; height: number }) {
  return (
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
        <Text style={{ fontSize: 5.5, fontWeight: 700, color: "#000000" }}>{caption}</Text>
      </View>
    </View>
  );
}

function PinShape({ pin }: { pin: UpfitPin }) {
  const scheme = getColorScheme(pin.colorScheme);
  const { width, height, horizontal, isCircle } = pinDims(pin);

  // Push bumper: draw the shared grille-guard outline as filled rounded
  // rects, stretched to the pin's box (preserveAspectRatio none).
  if (pin.shape === "pushbar") {
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
        }}
      >
        <Svg
          width={width}
          height={height}
          viewBox={`0 0 ${PUSHBAR_VIEWBOX.w} ${PUSHBAR_VIEWBOX.h}`}
          preserveAspectRatio="none"
        >
          {PUSHBAR_RECTS.map((r, i) => (
            <Rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.r} ry={r.r} fill="#18181b" />
          ))}
        </Svg>
        {pin.caption ? <CaptionPill caption={pin.caption} height={height} /> : null}
      </View>
    );
  }

  // Circle segments flow side-by-side (clipped to a disc by the
  // border-radius); rectangle segments follow the pin's orientation.
  const segmentDir: "row" | "column" = isCircle ? "row" : horizontal ? "row" : "column";
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
        // Circles are fully round; rectangles get a subtle pill curve
        // proportional to the short axis so long strips don't pinch.
        borderRadius: isCircle ? width / 2 : Math.min(width, height) * 0.2,
        overflow: "hidden",
        flexDirection: segmentDir,
      }}
    >
      {scheme.segments.map((c, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: c }} />
      ))}
      {pin.caption ? <CaptionPill caption={pin.caption} height={height} /> : null}
    </View>
  );
}

export function UpfitDocument({ data }: { data: UpfitPdfData }) {
  const styles = sharedStyles;
  const template = getTemplate(data.bodyStyle);
  const views = getViews(template);
  const firstViewKey = views[0]?.key ?? "main";
  const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
  const vehicleLabel = data.vehicleSummary ?? template.label;
  const generated = new Date();

  const footer = (
    <View style={styles.footer} fixed>
      <Text>
        {BRANDING.companyName} · Upfit spec {docNumber} · Generated {generated.toLocaleString("en-US")}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );

  return (
    <Document
      title={`Upfit spec ${docNumber}`}
      author={BRANDING.companyName}
      creator={BRANDING.companyName}
      producer={BRANDING.companyName}
    >
      {/* One page per side of the vehicle. */}
      {views.map((view, vi) => {
        const buf = loadTemplateImage(view.imageUrl);
        const viewPins = data.pins.filter((p) => (p.view ?? firstViewKey) === view.key);
        const isLast = vi === views.length - 1;
        return (
          <Page key={view.key} size="LETTER" style={styles.page}>
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

            <Text style={styles.sectionTitle}>
              Placement diagram{views.length > 1 ? ` — ${view.label}` : ""}
            </Text>
            <View style={{ position: "relative", width: PANEL_W, marginTop: 4 }}>
              {buf ? (
                <PdfImage src={buf} style={{ width: PANEL_W }} />
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
                    Diagram image not uploaded ({view.imageUrl})
                  </Text>
                </View>
              )}
              {viewPins.map((pin) => (
                <PinShape key={pin.id} pin={pin} />
              ))}
            </View>

            {/* Build notes print once, on the last diagram page. */}
            {isLast && data.notes ? (
              <View>
                <Text style={styles.sectionTitle}>Build notes</Text>
                <Text style={styles.blockLabel}>{data.notes}</Text>
              </View>
            ) : null}

            {footer}
          </Page>
        );
      })}

      {/* Final page: the actual quote for this build. */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{BRANDING.companyName}</Text>
            {BRANDING.tagline ? <Text style={styles.brandLine}>{BRANDING.tagline}</Text> : null}
          </View>
          <View>
            <Text style={styles.docTitle}>QUOTE</Text>
            <Text style={styles.docMeta}>#{docNumber}</Text>
            <Text style={styles.docMeta}>Status: {data.quoteStatus.replace(/_/g, " ")}</Text>
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

        <QuoteSections data={data} />

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

// Renders the linked quote's Parts / Labor / Fees sections + totals in
// the same sectioned style as the standalone quote PDF.
function QuoteSections({ data }: { data: UpfitPdfData }) {
  const styles = sharedStyles;
  const lines = data.quoteLineItems ?? [];
  const items = lines.filter((l) => l.kind === "item");
  const labor = lines.filter((l) => l.kind === "labor");
  const fees = lines.filter((l) => l.kind === "fee");

  let subtotal = 0;
  let discountTotal = 0;
  let laborTotal = 0;
  let feeTotal = 0;
  for (const l of lines) {
    if (l.kind === "item") {
      subtotal += lineGross(l);
      discountTotal += lineDiscount(l);
    } else if (l.kind === "labor") {
      laborTotal += (l.hours || 0) * (l.rate || 0);
    } else {
      feeTotal += l.amount || 0;
    }
  }

  if (lines.length === 0) {
    return (
      <View style={[styles.table, { marginTop: 12 }]}>
        <View style={styles.tableRowLast}>
          <Text style={[styles.tableCell, styles.cellLeft, { width: "100%", color: "#888" }]}>
            No line items on this quote yet.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      {items.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionTitle}>Parts &amp; Items</Text>
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
              const gross = lineGross(l);
              const disc = lineDiscount(l);
              return (
                <View key={`item-${idx}`} style={last ? styles.tableRowLast : styles.tableRow}>
                  <Text style={[styles.tableCell, styles.cellLeft, { width: "55%" }]}>{l.description}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>{l.quantity}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "15%" }]}>{money(l.unitPrice || 0)}</Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>
                    {disc > 0 ? money(disc) : "—"}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellRight, { width: "10%" }]}>{money(lineNet(l))}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {labor.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionTitle}>Labor</Text>
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
        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionTitle}>Fees &amp; Add-ons</Text>
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

      <View style={styles.totals}>
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
        {data.quoteTaxTotal > 0 && (
          <View style={styles.totalRow}>
            <Text>Tax</Text>
            <Text>{money(data.quoteTaxTotal)}</Text>
          </View>
        )}
        <View style={styles.grandTotalRow}>
          <Text>Total</Text>
          <Text>{money(data.quoteGrandTotal)}</Text>
        </View>
      </View>
    </View>
  );
}
