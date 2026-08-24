// Shared helpers for inventory packages (kits / canned services).
//
// A package stores its bundle as an array of PackageComponent (see schema).
// When a package is dropped onto a quote it is *expanded* into the quote
// editor's own line shape — one editable line per component — so the customer
// sees the full itemized breakdown. Keeping the expansion here (rather than
// inline in the editor) means the quote editor, the "save as package" flow,
// and any future PDF renderer all agree on the mapping.
//
// This module is pure (no server-only imports), so it is safe to import from
// both server actions and client components. Only the *type* comes from the
// schema, and `import type` is erased at build time.
import type { PackageComponent } from "@/db/schema";
import { allocatePromo } from "@/lib/promoAllocation";
import { discountAmount, round2 } from "@/lib/money";

// The quote editor's line shape. Mirrors QuoteLine in
// src/app/quotes/[id]/QuoteEditor.tsx. Components become lines with a
// zeroed per-line discount — discounting happens on the quote, not the
// package definition.
export type ExpandedQuoteLine =
  | {
      kind: "item";
      description: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      discountKind: "pct" | "amt";
      /**
       * Dollars allocated to this line from the package's bundle price. Kept
       * apart from `discount` so a bundle price and a hand-typed line discount
       * can BOTH apply — the bundle sets the deal, the discount comes off on
       * top — and so the rep can see which is which.
       */
      bundleDiscount?: number;
      fromLabel?: string;
      partId?: string;
      // Internal cost carried from the package (e.g. promo cost). When set,
      // `costLocked` tells the quote save path not to re-snapshot it from the
      // part's average cost, so the promo cost survives on the quote.
      cost?: number;
      costLocked?: boolean;
    }
  | { kind: "fee"; description: string; amount: number; fixed: boolean }
  | { kind: "labor"; description: string; hours: number; rate: number };

export function componentsToQuoteLines(components: PackageComponent[]): ExpandedQuoteLine[] {
  return (components ?? []).map((c) => {
    if (c.kind === "labor") {
      return { kind: "labor", description: c.description, hours: c.hours || 0, rate: c.rate || 0 };
    }
    if (c.kind === "fee") {
      return { kind: "fee", description: c.description, amount: c.amount || 0, fixed: !!c.fixed };
    }
    return {
      kind: "item",
      description: c.description,
      quantity: c.quantity || 0,
      unitPrice: c.unitPrice || 0,
      // The package's own per-line discount travels with the line. It used to be
      // zeroed here on the theory that discounting belongs on the quote; that
      // silently threw away a discount someone had deliberately built into the
      // package.
      discount: c.discount ?? 0,
      discountKind: c.discountKind ?? "pct",
      ...(c.fromLabel ? { fromLabel: c.fromLabel } : {}),
      partId: c.partId ?? undefined,
      // Carry the package's internal cost onto the line and lock it, so quote
      // save doesn't overwrite the promo cost with the part's average cost.
      ...(c.cost != null ? { cost: c.cost, costLocked: true } : {}),
    };
  });
}

// Undiscounted value of a package — parts (qty × unit price) + labor
// (hours × rate) + fees. Shown as a reference figure in the builder and
// package list; the real total is recomputed on the quote after discounts
// and tax.
/**
 * Expand a package onto quote lines, applying its sell-side bundle price (if
 * set) as per-line discounts on the PART lines so their line totals sum exactly
 * to the bundle price. Labor/fees are left at full price — a bundle/promo price
 * covers the parts. Reuses the promo allocation engine (integer cents, ties to
 * target exactly, refuses a price above the à la carte parts value).
 *
 * A bundle price ABOVE the à la carte total is not an error. That happens
 * routinely once add-ons are on the build and the negotiated number for the
 * whole bundle lands above the sum of list prices. In that case the part lines'
 * SELL PRICES are scaled proportionally to hit the target exactly, rather than a
 * discount being allocated — the bundle price is the authoritative total either
 * way. `scaled` reports which path ran.
 *
 * Labor and fees are never touched: a bundle/promo price covers the parts, and
 * install and freight quote on top.
 *
 * Returns the adjusted lines plus a status the editor can surface: `allocated`
 * when a discount was applied, `scaled` when line prices were raised, `error`
 * only when there is nothing to apply the price to at all.
 */
export function expandPackageWithBundlePrice(
  components: PackageComponent[],
  packagePrice: number | string | null | undefined,
): {
  lines: ExpandedQuoteLine[];
  allocated: boolean;
  scaled: boolean;
  error: string | null;
  saving: number | null;
} {
  const lines = componentsToQuoteLines(components);

  const raw = packagePrice == null ? "" : String(packagePrice).trim();
  const price = raw === "" ? null : Number(raw);
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return { lines, allocated: false, scaled: false, error: null, saving: null };
  }

  // Basis = each part line's extended sell value; allocate the bundle price
  // across only the item lines (in dollars), remembering their positions.
  const itemIdx: number[] = [];
  const allocInput: { sku: string; quantity: number; alacarteCostSnap: number }[] = [];
  lines.forEach((l, i) => {
    if (l.kind === "item") {
      itemIdx.push(i);
      allocInput.push({
        sku: l.description || `line ${i + 1}`,
        quantity: l.quantity || 0,
        alacarteCostSnap: l.unitPrice || 0,
      });
    }
  });
  if (allocInput.length === 0) {
    return {
      lines,
      allocated: false,
      scaled: false,
      error: "This package has no part lines to apply a bundle price to.",
      saving: null,
    };
  }

  // ── Target above list: scale the sell prices up to meet it ────────────────
  // The allocator only discounts downward, so this case used to be refused with
  // "it can't allocate" — which blocked the ordinary workflow of setting a
  // negotiated bundle price after add-ons had been added.
  const grossTotal = round2(
    allocInput.reduce((sum, l) => round2(sum + round2(l.quantity * l.alacarteCostSnap)), 0),
  );
  if (price > grossTotal + 0.005) {
    if (grossTotal <= 0) {
      return {
        lines,
        allocated: false,
        scaled: false,
        error:
          "The part lines have no sell price to scale from. Set a sell price on at least one part, then the bundle price can be spread across them.",
        saving: null,
      };
    }
    // Apportion in integer cents so the unit prices themselves add up to the
    // target. Scaling each line and rounding independently would leave a cent or
    // two over, which then has to show up as a "Discount $0.01" line on the
    // customer's quote — noise on a document someone signs.
    //
    // Round each unit DOWN first (so the total lands at or just under target),
    // then hand out the remaining cents one unit-cent at a time. Raising a
    // line's unit price by a cent moves the total by its quantity, so a line
    // with qty 2 moves the total 2c — which is why this is a coin problem and
    // not a simple division.
    const targetCents = Math.round(price * 100);
    const out: ExpandedQuoteLine[] = lines.map((l) => ({ ...l }));

    const qtyOf = (idx: number) => {
      const l = out[idx];
      return l.kind === "item" ? l.quantity || 0 : 0;
    };
    const baseCents = itemIdx.reduce((sum, idx) => {
      const l = out[idx];
      return l.kind === "item" ? sum + qtyOf(idx) * Math.round((l.unitPrice || 0) * 100) : sum;
    }, 0);
    if (baseCents <= 0) {
      return {
        lines,
        allocated: false,
        scaled: false,
        error:
          "The part lines have no sell price to scale from. Set a sell price on at least one part, then the bundle price can be spread across them.",
        saving: null,
      };
    }

    const unitCents = new Map<number, number>();
    let sumCents = 0;
    for (const idx of itemIdx) {
      const line = out[idx];
      if (line.kind !== "item") continue;
      const listCents = Math.round((line.unitPrice || 0) * 100);
      const scaled = Math.floor((listCents * targetCents) / baseCents);
      unitCents.set(idx, scaled);
      sumCents += qtyOf(idx) * scaled;
    }

    // Hand out the remaining cents, biggest quantities first so it converges
    // quickly — and never onto a line with no sell price, so a $0 accessory
    // stays $0 rather than quietly becoming a cent.
    let shortfall = targetCents - sumCents;
    const absorbers = itemIdx
      .filter((idx) => qtyOf(idx) > 0 && (unitCents.get(idx) ?? 0) > 0)
      .sort((a, b) => qtyOf(b) - qtyOf(a));
    let progress = true;
    while (shortfall > 0 && progress) {
      progress = false;
      for (const idx of absorbers) {
        if (qtyOf(idx) <= shortfall) {
          unitCents.set(idx, (unitCents.get(idx) ?? 0) + 1);
          shortfall -= qtyOf(idx);
          progress = true;
          if (shortfall === 0) break;
        }
      }
    }

    // If no combination of quantities can make up the last few cents — every
    // line has qty 2 and one cent is left over, say — overshoot by the smallest
    // step available and take the difference back off as a rounding adjustment.
    // Any line with qty 1 makes this unreachable, which covers most builds.
    let excessCents = 0;
    if (shortfall > 0 && absorbers.length > 0) {
      const cheapest = absorbers[absorbers.length - 1]; // smallest quantity → smallest overshoot
      unitCents.set(cheapest, (unitCents.get(cheapest) ?? 0) + 1);
      excessCents = qtyOf(cheapest) - shortfall;
      shortfall = 0;
    }

    for (const idx of itemIdx) {
      const line = out[idx];
      if (line.kind !== "item") continue;
      line.unitPrice = round2((unitCents.get(idx) ?? 0) / 100);
    }

    if (excessCents > 0) {
      let biggest = -1;
      let biggestValue = -1;
      for (const idx of itemIdx) {
        const line = out[idx];
        if (line.kind !== "item") continue;
        const ext = round2(qtyOf(idx) * (line.unitPrice || 0));
        if (ext > biggestValue) {
          biggestValue = ext;
          biggest = idx;
        }
      }
      const line = biggest >= 0 ? out[biggest] : null;
      if (line && line.kind === "item") {
        line.bundleDiscount = round2((line.bundleDiscount ?? 0) + excessCents / 100);
      }
    }
    return { lines: out, allocated: false, scaled: true, error: null, saving: null };
  }

  // Reuse the promo allocation engine on the SELL basis. It throws when the
  // bundle price exceeds the à la carte value of the parts.
  let result;
  try {
    result = allocatePromo({ packagePrice: price, lines: allocInput });
  } catch (e) {
    return {
      lines,
      allocated: false,
      scaled: false,
      error: e instanceof Error ? e.message : "Could not allocate bundle price.",
      saving: null,
    };
  }

  const out: ExpandedQuoteLine[] = lines.map((l) => ({ ...l }));
  result.lines.forEach((al, k) => {
    const idx = itemIdx[k];
    const line = out[idx];
    if (line.kind === "item") {
      const gross = (line.unitPrice || 0) * (line.quantity || 0);
      const disc = Math.max(0, gross - al.allocatedExtended);
      // Into bundleDiscount, NOT discount: overwriting `discount` here wiped out
      // any per-line discount the package carried.
      line.bundleDiscount = round2(disc);
    }
  });
  return { lines: out, allocated: true, scaled: false, error: null, saving: result.saving };
}

export type PackageTotals = {
  /**
   * Parts at the sell prices actually on the rows, before any reduction. When
   * a bundle price scaled the rows up this is the SCALED figure — it is what
   * the rows on screen add up to, so use it to check that they foot.
   */
  partsGross: number;
  /**
   * Parts at the catalogue sell prices the components were saved with — the
   * true à la carte value, unaffected by any bundle price. This is what
   * "Retail (list)" means, and what a saving or an uplift is measured against.
   */
  alacarteGross: number;
  /** True when the bundle price was above à la carte and the rows were scaled up to it. */
  scaled: boolean;
  /**
   * Dollars the bundle price adds over à la carte (0 unless `scaled`). The
   * mirror image of `bundleDiscount`.
   */
  uplift: number;
  /** Dollars taken off by the bundle/promo price allocation. */
  bundleDiscount: number;
  /** Dollars taken off by per-line discounts, ON TOP of the bundle price. */
  lineDiscount: number;
  /** What the customer pays for parts: gross − bundle − per-line. */
  partsNet: number;
  labor: number;
  fees: number;
  /** Parts net + labor + fees. Tax is applied on the quote, not here. */
  total: number;
};

/**
 * The package's money, in one place, in the same order the quote applies it:
 * list price → bundle/promo allocation → per-line discount. Rounds each line to
 * the cent before summing so the rows shown in the builder foot to the totals
 * underneath them.
 *
 * Both reductions compose deliberately: a bundle price is the negotiated deal,
 * and a per-line discount still comes off on top of it. Neither wins.
 */
export function packageTotals(
  components: PackageComponent[],
  packagePrice?: number | string | null,
): PackageTotals {
  const { lines, scaled } = expandPackageWithBundlePrice(components ?? [], packagePrice ?? null);

  // Measured off the components as saved, so a scaled-up bundle price does not
  // rewrite what "list" means. Without this, setting a bundle price of $14,378
  // on a $14,275 build would make the screen claim list was $14,378 and the
  // customer saved a penny.
  const alacarteGross = round2(
    (components ?? []).reduce(
      (sum, c) => (c.kind === "item" ? round2(sum + round2((c.quantity || 0) * (c.unitPrice || 0))) : sum),
      0,
    ),
  );

  let partsGross = 0;
  let bundleDiscount = 0;
  let lineDiscount = 0;
  let labor = 0;
  let fees = 0;

  for (const l of lines) {
    if (l.kind === "item") {
      const gross = round2((l.quantity || 0) * (l.unitPrice || 0));
      const bundle = discountAmount(gross, l.bundleDiscount, "amt");
      const manual = discountAmount(gross - bundle, l.discount, l.discountKind);
      partsGross = round2(partsGross + gross);
      bundleDiscount = round2(bundleDiscount + bundle);
      lineDiscount = round2(lineDiscount + manual);
    } else if (l.kind === "labor") {
      labor = round2(labor + (l.hours || 0) * (l.rate || 0));
    } else {
      fees = round2(fees + (l.amount || 0));
    }
  }

  const partsNet = round2(partsGross - bundleDiscount - lineDiscount);
  return {
    partsGross,
    alacarteGross,
    scaled,
    uplift: scaled ? round2(Math.max(0, partsNet - alacarteGross)) : 0,
    bundleDiscount,
    lineDiscount,
    partsNet,
    labor,
    fees,
    total: round2(partsNet + labor + fees),
  };
}

export function packageValue(components: PackageComponent[]): number {
  let total = 0;
  for (const c of components ?? []) {
    if (c.kind === "item") total += (c.quantity || 0) * (c.unitPrice || 0);
    else if (c.kind === "labor") total += (c.hours || 0) * (c.rate || 0);
    else total += c.amount || 0;
  }
  return total;
}

/** Distinct part ids referenced by a package's item components. */
export function packagePartIds(components: PackageComponent[]): string[] {
  const ids = new Set<string>();
  for (const c of components ?? []) {
    if (c.kind === "item" && c.partId) ids.add(c.partId);
  }
  return [...ids];
}

/**
 * Internal cost of a package's parts: Σ (item qty × part cost), using the cost
 * resolved per part id (weighted-average, from the caller). Only item lines
 * with a resolvable cost count toward `cost`; `costedValue` is the sell value
 * of just those lines, so margin isn't understated when some parts have no cost
 * yet. Labor/fees are excluded from cost (they're not inventory).
 */
export function packageCost(
  components: PackageComponent[],
  costByPartId: Map<string, number>,
): { cost: number; costedValue: number; itemValue: number; missing: number } {
  let cost = 0;
  let costedValue = 0;
  let itemValue = 0;
  let missing = 0;
  for (const c of components ?? []) {
    if (c.kind !== "item") continue;
    const qty = c.quantity || 0;
    itemValue += qty * (c.unitPrice || 0);
    // Prefer the component's own internal cost (e.g. promo cost); fall back to
    // the part's average cost resolved by the caller.
    const unit = c.cost != null ? c.cost : c.partId ? costByPartId.get(c.partId) : undefined;
    if (unit != null) {
      cost += qty * unit;
      costedValue += qty * (c.unitPrice || 0);
    } else {
      missing += 1;
    }
  }
  return { cost, costedValue, itemValue, missing };
}

// Coerce an arbitrary components payload (from a form, API body, or CSV) into
// the PackageComponent shape. Unknown line kinds are dropped rather than
// trusted, and every number is coerced so a stray string can never land in the
// jsonb column. Shared by the API routes, the builder save action, and the
// importer so validation stays in one place.
export function sanitizeComponents(input: unknown): PackageComponent[] {
  if (!Array.isArray(input)) return [];
  const out: PackageComponent[] = [];
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (c.kind === "labor") {
      out.push({
        kind: "labor",
        description: String(c.description ?? "Labor"),
        hours: num(c.hours),
        rate: num(c.rate),
      });
    } else if (c.kind === "fee") {
      out.push({
        kind: "fee",
        description: String(c.description ?? "Fee"),
        amount: num(c.amount),
        fixed: !!c.fixed,
      });
    } else if (c.kind === "item") {
      out.push({
        kind: "item",
        description: String(c.description ?? ""),
        quantity: Math.max(0, Math.trunc(num(c.quantity))),
        unitPrice: num(c.unitPrice),
        // Preserve the internal cost when present (blank/invalid → null).
        cost: c.cost == null || c.cost === "" ? null : num(c.cost),
        discount: c.discount == null || c.discount === "" ? null : Math.max(0, num(c.discount)),
        discountKind: c.discountKind === "amt" ? "amt" : c.discountKind === "pct" ? "pct" : null,
        fromLabel: c.fromLabel ? String(c.fromLabel) : null,
        partId: c.partId ? String(c.partId) : null,
        sku: c.sku ? String(c.sku) : null,
      });
    }
  }
  return out;
}

export function packageCounts(components: PackageComponent[]): {
  parts: number;
  labor: number;
  fees: number;
} {
  let parts = 0;
  let labor = 0;
  let fees = 0;
  for (const c of components ?? []) {
    if (c.kind === "item") parts++;
    else if (c.kind === "labor") labor++;
    else fees++;
  }
  return { parts, labor, fees };
}
