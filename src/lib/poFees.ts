// Purchase-order fee math — PURE and DETERMINISTIC: no I/O, no db, no clock, no
// randomness. Same input → same output.
//
// A PO can carry vendor charges that aren't parts. They split into two kinds,
// and the split is an accounting decision rather than a cosmetic one:
//
//   freight → CAPITALIZED into the parts' landed cost. Allocated across the
//     receivable lines in proportion to extended value, then folded into each
//     line's unit cost, so the FIFO layer written on receipt carries true landed
//     cost. Because the layer carries it, Inventory (1200), the moving average,
//     parts.cost and the GRNI accrual all pick freight up for free — none of
//     those call sites need to know fees exist.
//   other  → EXPENSED to 5230 Purchase Fees & Surcharges on first receipt.
//     Handling, customs, surcharges: not part of what a part costs, so they
//     never touch a FIFO layer.
//
// All arithmetic runs in integer cents. A largest-remainder plug puts the
// residual cent or two on the largest line so allocated freight ties to the
// entered freight EXACTLY.
//
// Types here are structural on purpose (rather than importing POFee/POLineItem
// from the schema) so this module stays pure and unit-testable without pulling
// in drizzle. See src/lib/poFees.test.ts.

/** Fee kinds. `freight` capitalizes into part cost; `other` is expensed. */
export type POFeeKind = "freight" | "other";

/** Label of the standing Freight/shipping row every PO shows. */
export const FIXED_FREIGHT_LABEL = "Freight/shipping";

const toCents = (n: number) => Math.round((Number(n) || 0) * 100);

type FeeLike = { description?: string; amount?: number; kind?: string; fixed?: boolean };

/** Structurally the schema's POFee — kept local so this module stays pure. */
export type FeeRow = {
  id?: string;
  description: string;
  amount: number;
  kind: POFeeKind;
  fixed?: boolean;
};

/**
 * Put the fee list in the shape the editor renders: exactly one fixed
 * Freight/shipping row, first, followed by the custom rows in their own order.
 *
 * The fixed row is synthesized when a PO has none — every PO shows a freight
 * line whether or not anyone has typed an amount into it yet, so the team fills
 * it in directly instead of adding a row first. It carries no special meaning
 * downstream: it's an ordinary `kind: 'freight'` fee, so receiving capitalizes
 * it through the same path as any other freight, with no special case.
 */
export function withFixedFreight(fees: readonly FeeRow[] | null | undefined): FeeRow[] {
  const list = [...(fees ?? [])];
  const at = list.findIndex((f) => f?.fixed);
  if (at >= 0) return [list[at], ...list.filter((_, i) => i !== at)];
  return [{ description: FIXED_FREIGHT_LABEL, amount: 0, kind: "freight", fixed: true }, ...list];
}

/**
 * Drop the rows that carry nothing: a zero-amount fixed row (the editor
 * re-synthesizes it every render, so persisting an empty one only clutters the
 * record) and any blank custom row.
 */
export function pruneFees<T extends FeeLike>(fees: readonly T[] | null | undefined): T[] {
  return (fees ?? []).filter((f) => {
    const amount = Number(f?.amount) || 0;
    if (f?.fixed) return amount !== 0;
    return amount !== 0 || String(f?.description ?? "").trim() !== "";
  });
}

export type FeeTotals = {
  /** Σ freight-kind fees, integer cents. Capitalized into landed cost. */
  freightCents: number;
  /** Σ other-kind fees, integer cents. Expensed on first receipt. */
  otherCents: number;
  /** freightCents + otherCents. What the PO total adds on top of its lines. */
  totalCents: number;
};

/** Split a PO's fees into the freight (capitalized) and other (expensed) buckets. */
export function feeTotals(fees: readonly { kind?: string; amount?: number }[] | null | undefined): FeeTotals {
  let freightCents = 0;
  let otherCents = 0;
  for (const f of fees ?? []) {
    const cents = toCents(f?.amount ?? 0);
    if (cents <= 0) continue; // ignore blank/zero/negative rows
    if (f?.kind === "freight") freightCents += cents;
    else otherCents += cents;
  }
  return { freightCents, otherCents, totalCents: freightCents + otherCents };
}

/** The shape allocateFreight needs off a PO line. */
export type FreightAllocationLine = {
  partId?: string | null;
  quantity?: number;
  unitCost?: number;
};

/**
 * Spread `freightCents` across `lines`, returning an index-aligned array of cents
 * that sums to exactly `freightCents`.
 *
 * Only lines that can actually become a costing layer — a linked part and a
 * positive quantity — are eligible; everything else gets 0, because freight
 * allocated to a line that never produces a receipt layer would be stranded.
 *
 * Allocation is proportional to extended value (unit cost × qty). When the
 * eligible lines carry no value at all (a PO of $0 lines, e.g. warranty
 * replacements that still cost freight), it falls back to allocating by
 * quantity so the freight still lands somewhere sensible.
 */
export function allocateFreight(lines: readonly FreightAllocationLine[], freightCents: number): number[] {
  const out = new Array<number>(lines.length).fill(0);
  const freight = Math.round(freightCents);
  if (!(freight > 0) || lines.length === 0) return out;

  const eligible: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const qty = Math.trunc(Number(l?.quantity) || 0);
    if (l?.partId && qty > 0) eligible.push(i);
  }
  if (eligible.length === 0) return out; // nothing receivable — nothing to capitalize onto

  const qtyOf = (i: number) => Math.trunc(Number(lines[i]?.quantity) || 0);
  const basisOf = (i: number) => toCents(Number(lines[i]?.unitCost) || 0) * qtyOf(i);

  let weights = eligible.map(basisOf);
  let totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    // Zero-value basket: fall back to quantity so freight isn't dropped.
    weights = eligible.map(qtyOf);
    totalWeight = weights.reduce((a, b) => a + b, 0);
  }
  if (totalWeight <= 0) return out;

  const alloc = weights.map((w) => Math.round((w * freight) / totalWeight));

  // Rounding plug: the residual goes on the single largest-weight line so the
  // allocation ties to the entered freight exactly.
  const residual = freight - alloc.reduce((a, b) => a + b, 0);
  if (residual !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[maxIdx]) maxIdx = i;
    alloc[maxIdx] += residual;
  }

  for (let k = 0; k < eligible.length; k++) out[eligible[k]] = alloc[k];
  return out;
}

/**
 * A line's landed per-unit cost in dollars, rounded to 2dp — what the FIFO layer
 * stores as its unit cost.
 *
 * A costing layer holds a single 2-decimal unit cost, so per-unit freight has to
 * be rounded to the cent. That means qty × landedUnitCost can differ from
 * (qty × unitCost + lineFreight) by a few cents on awkward splits; the layer's
 * 2dp unit cost is the authority, and the ledger is posted from the same landed
 * figure, so Inventory and the FIFO subledger stay tied to each other.
 */
export function landedUnitCost(unitCost: number, quantity: number, lineFreightCents: number): number {
  const qty = Math.trunc(Number(quantity) || 0);
  const baseCents = toCents(unitCost);
  if (qty <= 0) return baseCents / 100;
  const perUnit = Math.round((Math.round(lineFreightCents) || 0) / qty);
  return (baseCents + perUnit) / 100;
}
