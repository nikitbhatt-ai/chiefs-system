// Shared React-PDF stylesheet. Every document uses these base styles for
// page chrome, headers, tables, and totals. Per-template stylesheets can
// extend; avoid forking the basics so PDFs stay consistent.

import { Font, StyleSheet } from "@react-pdf/renderer";
import { BRANDING } from "./branding";

// React-PDF hyphenates by default, which put "Customer Department Graphics - 3M
// re-flective" on a customer's invoice. An inserted hyphen mid-word reads as a
// typo on a document someone signs, so words wrap whole instead.
Font.registerHyphenationCallback((word) => [word]);

export const sharedStyles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 64,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: BRANDING.textColor,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: BRANDING.textColor,
  },
  brandBlock: { flexDirection: "column" },
  brandName: { fontSize: 16, fontWeight: 700 },
  brandLine: { fontSize: 9, color: BRANDING.mutedColor, marginTop: 2 },
  docTitle: { fontSize: 20, fontWeight: 700, textAlign: "right" },
  docMeta: { fontSize: 9, color: BRANDING.mutedColor, marginTop: 4, textAlign: "right" },

  /**
   * Page style for documents that use the running masthead below. Separate
   * from `page` so the purchase-order / work-order / upfit templates, which
   * still print their header in the normal flow, don't inherit a 130pt gap.
   */
  pageWithRunningHeader: {
    paddingTop: 132,
    paddingBottom: 64,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: BRANDING.textColor,
    backgroundColor: "#ffffff",
  },

  // ── Running header ───────────────────────────────────────────────────────
  // A masthead that repeats on every page: logo + company block top-left, the
  // document number and assigned sales rep top-right. Absolutely positioned
  // and `fixed` so a three-page invoice identifies itself on page 3 as well as
  // page 1; `page.paddingTop` reserves the room it occupies.
  runningHeader: {
    position: "absolute",
    top: 34,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: BRANDING.textColor,
  },
  /** 4:1 landscape slot. `objectFit: contain` keeps any aspect ratio intact. */
  logo: { width: 150, height: 38, objectFit: "contain", marginBottom: 4 },
  logoWordmark: { fontSize: 15, fontWeight: 700, letterSpacing: 0.3, marginBottom: 2 },
  headerRight: { alignItems: "flex-end", maxWidth: 220 },
  /** The sales rep line — a name, so it reads darker than the muted meta rows. */
  docRep: { fontSize: 9, marginTop: 4, textAlign: "right", color: BRANDING.textColor },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: BRANDING.mutedColor,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 4,
    marginTop: 12,
  },
  twoCol: { flexDirection: "row", justifyContent: "space-between" },
  blockLabel: { fontSize: 9, color: BRANDING.mutedColor },
  blockValue: { fontSize: 11, marginTop: 2 },
  table: { marginTop: 12, borderWidth: 1, borderColor: BRANDING.textColor },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BRANDING.textColor },
  tableRowLast: { flexDirection: "row" },
  tableHeader: { backgroundColor: "#eeeeee", fontWeight: 700 },
  tableCell: { paddingVertical: 6, paddingHorizontal: 8, fontSize: 10 },
  cellLeft: { textAlign: "left" },
  cellRight: { textAlign: "right" },
  totals: { marginTop: 16, alignSelf: "flex-end", width: 220 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    fontSize: 11,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 2,
    borderTopColor: BRANDING.textColor,
    fontWeight: 700,
    fontSize: 13,
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: BRANDING.mutedColor,
    borderTopWidth: 1,
    borderTopColor: "#cccccc",
    paddingTop: 8,
  },
  watermark: {
    position: "absolute",
    top: "45%",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 80,
    color: "#fde8c8",
    fontWeight: 700,
    transform: "rotate(-25deg)",
  },
});
