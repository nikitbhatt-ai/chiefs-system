// Internal cost on a quote/invoice line — what we paid, against what we sell it
// for. Shared by the quote editor, the print view and the PDF so the margin a
// rep negotiates against is the same number every surface shows.
//
// NOTE: this is internal-only information. It belongs on the editor and on the
// INTERNAL copy of a document; it must never reach the customer-facing PDF or
// print view. See `docs/REQUIREMENTS.md`.

import { round2 } from "./money";

export type CostableLine = {
  kind: string;
  quantity?: number;
  unitPrice?: number;
  /** Cost carried on the line itself — a promo's negotiated cost, typically. */
  cost?: number | null;
  /** Marks the line's own `cost` as authoritative over the part's average. */
  costLocked?: boolean;
  partId?: string | null;
};

/** partId → weighted-average unit cost, as resolved from `parts`. */
export type PartCostMap = Record<string, number>;

/**
 * The internal unit cost for a line.
 *
 * Order matters:
 *  1. A **locked** cost on the line wins. That is a promo/package cost that was
 *     negotiated for this build; today's moving average is not what we paid.
 *  2. Otherwise the part's weighted-average cost — the basis job costing uses,
 *     and the number the request asked for ("the internal avg cost").
 *  3. Otherwise any unlocked cost the line happens to carry.
 *
 * Returns null when nothing is known, so callers can print "—" rather than
 * implying a line costs nothing. A free accessory and an uncosted one are very
 * different things to a rep quoting margin.
 */
export function lineUnitCost(l: CostableLine, partCosts: PartCostMap = {}): number | null {
  if (l.kind !== "item") return null;
  if (l.costLocked && l.cost != null) return round2(l.cost);
  const avg = l.partId ? partCosts[l.partId] : undefined;
  if (avg != null && Number.isFinite(avg)) return round2(avg);
  if (l.cost != null && Number.isFinite(l.cost)) return round2(l.cost);
  return null;
}

/** Extended internal cost for a line (unit cost × quantity), or null if unknown. */
export function lineExtCost(l: CostableLine, partCosts: PartCostMap = {}): number | null {
  const unit = lineUnitCost(l, partCosts);
  if (unit == null) return null;
  return round2(unit * (l.quantity || 0));
}

export type CostRollup = {
  /** Extended cost of every line whose cost is known. */
  cost: number;
  /** How many item lines had no cost — the rollup understates by these. */
  unknown: number;
  /** Customer-facing net for the same lines, so margin compares like with like. */
  net: number;
  /** net − cost. */
  margin: number;
  /** Margin as a percentage of net, or null when net is zero. */
  marginPct: number | null;
};

/**
 * Roll internal cost and margin across lines.
 *
 * `net` is supplied by the caller rather than recomputed here, because the
 * customer-facing net already has one owner (`quoteTotals` / `lineNet`) and a
 * second implementation of discount arithmetic is exactly the bug this codebase
 * has already been bitten by twice.
 *
 * Lines with no known cost are counted in `unknown` instead of being treated as
 * free, so a rep can see that a margin figure is incomplete.
 */
export function costRollup(
  lines: CostableLine[],
  net: number,
  partCosts: PartCostMap = {},
): CostRollup {
  let cost = 0;
  let unknown = 0;
  for (const l of lines) {
    if (l.kind !== "item") continue;
    const ext = lineExtCost(l, partCosts);
    if (ext == null) unknown++;
    else cost = round2(cost + ext);
  }
  const margin = round2(net - cost);
  return { cost, unknown, net, margin, marginPct: net > 0 ? round2((margin / net) * 100) : null };
}
