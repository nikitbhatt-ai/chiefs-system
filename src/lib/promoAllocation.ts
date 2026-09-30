// Promo allocation engine — Phase 3. PURE and DETERMINISTIC: no I/O, no db, no
// clock, no randomness. Same input → same output. This is the ONLY place a
// package price becomes per-part costs, and it runs for a package purchase only
// (never for an individual PO line).
//
// The single package price is spread across the lines in proportion to each
// line's extended à la carte cost (unit cost × quantity). Freight, if entered,
// is folded into the package price first so it spreads the same way. A rounding
// plug puts the residual cent or two on the single largest line so the allocated
// line totals sum to the package price EXACTLY. Finally we assert every
// allocated unit cost sits at or below its à la carte snapshot — a package that
// costs more than its parts à la carte is a data-entry mistake, so we refuse it.
//
// All arithmetic runs in integer cents so the tie to the package price is exact.

export type PromoAllocationLineInput = {
  sku: string;
  quantity: number;
  alacarteCostSnap: number; // per-unit à la carte cost, dollars
};

export type PromoAllocationInput = {
  packagePrice: number; // dollars
  freight?: number | null; // dollars, optional
  lines: PromoAllocationLineInput[];
};

export type AllocatedLine = {
  sku: string;
  quantity: number;
  alacarteCostSnap: number;
  extendedBasis: number; // alacarte × qty
  allocatedExtended: number; // this line's share of the package price (ties exactly)
  allocatedUnitCost: number; // allocatedExtended / qty, 2dp — what a PO line carries
};

export type PromoAllocationResult = {
  effectivePackagePrice: number; // package price + freight
  totalBasis: number; // Σ extendedBasis (the full à la carte value)
  factor: number; // effectivePackagePrice / totalBasis
  allocatedTotal: number; // Σ allocatedExtended (== effectivePackagePrice)
  saving: number; // totalBasis − effectivePackagePrice
  lines: AllocatedLine[];
};

export class PromoAllocationError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toCents = (n: number) => Math.round(n * 100);

/**
 * Allocate a package price across its lines. Throws PromoAllocationError on
 * invalid input or when the package costs more than its à la carte basket.
 */
export function allocatePromo(input: PromoAllocationInput): PromoAllocationResult {
  const lines = input.lines ?? [];
  if (lines.length === 0) throw new PromoAllocationError("A promo needs at least one line.");

  // Extended basis per line, in integer cents (2dp × integer qty → exact).
  const basisCents: number[] = [];
  const quantities: number[] = [];
  for (const [i, l] of lines.entries()) {
    const qty = Math.trunc(l.quantity);
    if (!(qty > 0)) throw new PromoAllocationError(`Line ${i + 1} (${l.sku}): quantity must be greater than zero.`);
    if (!Number.isFinite(l.alacarteCostSnap) || l.alacarteCostSnap < 0)
      throw new PromoAllocationError(`Line ${i + 1} (${l.sku}): à la carte cost is missing or invalid.`);
    quantities.push(qty);
    basisCents.push(toCents(l.alacarteCostSnap) * qty);
  }

  const totalBasisCents = basisCents.reduce((a, b) => a + b, 0);
  if (totalBasisCents <= 0)
    throw new PromoAllocationError("Total à la carte basis is zero — set à la carte costs before allocating.");

  const effCents = toCents(input.packagePrice) + toCents(input.freight ?? 0);
  if (effCents <= 0) throw new PromoAllocationError("Package price must be greater than zero.");

  // Proportional allocation, integer cents.
  const allocCents = basisCents.map((b) => Math.round((b * effCents) / totalBasisCents));

  // Rounding plug: the residual goes on the single largest-basis line so the
  // allocated line totals sum to the package price exactly.
  const residual = effCents - allocCents.reduce((a, b) => a + b, 0);
  if (residual !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < basisCents.length; i++) if (basisCents[i] > basisCents[maxIdx]) maxIdx = i;
    allocCents[maxIdx] += residual;
  }

  const outLines: AllocatedLine[] = lines.map((l, i) => {
    const qty = quantities[i];
    const allocatedUnitCost = round2(allocCents[i] / qty / 100);
    // Sanity: allocated unit cost must not exceed the à la carte snapshot.
    if (toCents(allocatedUnitCost) > toCents(l.alacarteCostSnap)) {
      throw new PromoAllocationError(
        `Line ${i + 1} (${l.sku}): allocated unit cost $${allocatedUnitCost.toFixed(2)} exceeds à la carte ` +
          `$${round2(l.alacarteCostSnap).toFixed(2)}. The package price is higher than the basket's à la carte ` +
          `value — check the price and quantities.`,
      );
    }
    return {
      sku: l.sku,
      quantity: qty,
      alacarteCostSnap: round2(l.alacarteCostSnap),
      extendedBasis: basisCents[i] / 100,
      allocatedExtended: allocCents[i] / 100,
      allocatedUnitCost,
    };
  });

  const effectivePackagePrice = effCents / 100;
  const totalBasis = totalBasisCents / 100;
  return {
    effectivePackagePrice,
    totalBasis,
    factor: effCents / totalBasisCents,
    allocatedTotal: allocCents.reduce((a, b) => a + b, 0) / 100,
    saving: round2(totalBasis - effectivePackagePrice),
    lines: outLines,
  };
}
