// One definition of what money looks like and how it rounds.
//
// The complaint this exists for: currency fields on the builders rendered as
// bare numbers ("1250", "0"), indistinguishable at a glance from the quantity
// box sitting next to them. Every currency figure in the app now carries a `$`
// and exactly two decimals — in readouts AND in the input boxes — and quantities
// deliberately carry neither.
//
// Pure module, no server-only imports, so client builders and server actions
// share it.

/**
 * Round to the cent. `Number.EPSILON` nudges the classic binary-float case
 * (1.005 → 1.00 without it) onto the right side before rounding.
 *
 * This is THE rounding function for money. `quoteTotals` re-exports it rather
 * than defining a second one, because two subtly different rounders is how
 * printed line totals stop adding up to the grand total.
 */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `$1,234.56` — for display. Always signed correctly, always two decimals. */
export function fmtUSD(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : n;
  return USD.format(Number.isFinite(v as number) ? (v as number) : 0);
}

/**
 * Parse what someone typed into a money box. Tolerates `$`, thousands commas,
 * stray spaces, and a leading `+`. Returns null for empty or unparseable input
 * so a caller can tell "cleared" from "zero" — clearing a cost is how you say
 * "this line has no internal cost", which is not the same as it costing nothing.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const cleaned = input.replace(/[$,\s]/g, "").replace(/^\+/, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** `1234.56` — the text form for an input box (no `$`, no grouping commas). */
export function moneyInputValue(n: number | string | null | undefined): string {
  const v = parseMoney(n as string);
  return v == null ? "" : v.toFixed(2);
}

/** A quantity: whole, never negative, no currency dressing. */
export function parseQty(input: string | number | null | undefined): number {
  const n = typeof input === "number" ? input : Number(String(input ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** Hours allow quarters, so they are not integers — but they are not money either. */
export function parseHours(input: string | number | null | undefined): number {
  const n = typeof input === "number" ? input : Number(String(input ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * A line's discount in dollars, given its pre-discount value.
 *
 * Percent discounts are taken off the value passed in, which is what lets a
 * package's per-line discount stack on top of a bundle price: pass the
 * bundle-allocated price and "10%" means 10% off the promo price, not 10% off
 * list. Rounded to the cent here so the row and the total agree.
 */
export function discountAmount(
  base: number,
  discount: number | null | undefined,
  kind: "pct" | "amt" | null | undefined,
): number {
  const d = discount || 0;
  if (d <= 0) return 0;
  const raw = kind === "pct" ? base * (d / 100) : d;
  // Never discount below zero — a 150% discount is a typo, not a refund.
  return round2(Math.min(Math.max(raw, 0), base));
}
