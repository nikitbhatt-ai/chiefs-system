// Single source of truth for quote / invoice money math.
//
// The rule: round each line's discount (and each line's extended value) to the
// cent BEFORE summing. That way the printed per-line totals always add up to the
// grand total. Summing the un-rounded discounts and rounding once at the end
// produces a total that's a penny off from what the line rows show
// (round-then-sum vs sum-then-round). Everything that displays quote money —
// the editor, the save path, the print view, and the PDF — goes through here.
//
// Pure module (no server-only imports) so the client editor can use it too.

export type TotalsLine = {
  kind?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  discountKind?: "pct" | "amt";
  hours?: number;
  rate?: number;
  amount?: number;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** An item line's extended (pre-discount) value, to the cent. */
export function lineGross(l: TotalsLine): number {
  return round2((l.quantity || 0) * (l.unitPrice || 0));
}

/** An item line's discount in dollars, rounded to the cent (matches the row). */
export function lineDiscount(l: TotalsLine): number {
  const gross = (l.quantity || 0) * (l.unitPrice || 0);
  const raw = l.discountKind === "pct" ? gross * ((l.discount || 0) / 100) : l.discount || 0;
  return round2(raw);
}

/** An item line's net total (gross − rounded discount) — what the row shows. */
export function lineNet(l: TotalsLine): number {
  return round2(lineGross(l) - lineDiscount(l));
}

export type QuoteTotals = {
  subtotal: number;
  discountTotal: number;
  feeTotal: number;
  laborTotal: number;
  tax: number;
  grand: number;
};

/**
 * Roll up quote totals from rounded per-line figures so the rows foot to the
 * grand. `taxRatePct` is a percent (e.g. 8.25). Pass 0 for no tax.
 */
export function quoteTotals(lines: TotalsLine[], taxRatePct: number): QuoteTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let feeTotal = 0;
  let laborTotal = 0;
  for (const l of lines ?? []) {
    if (l.kind === "item") {
      subtotal = round2(subtotal + lineGross(l));
      discountTotal = round2(discountTotal + lineDiscount(l));
    } else if (l.kind === "labor") {
      laborTotal = round2(laborTotal + (l.hours || 0) * (l.rate || 0));
    } else if (l.kind === "fee") {
      feeTotal = round2(feeTotal + (l.amount || 0));
    }
  }
  const taxBase = round2(subtotal - discountTotal + feeTotal + laborTotal);
  const tax = round2(taxBase * ((taxRatePct || 0) / 100));
  const grand = round2(taxBase + tax);
  return { subtotal, discountTotal, feeTotal, laborTotal, tax, grand };
}
