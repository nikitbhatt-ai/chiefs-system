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
      discount: 0,
      discountKind: "pct",
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
 * Returns the (possibly discounted) lines plus a status the editor can surface:
 * `allocated` true when a discount was applied, `error` when a bundle price was
 * set but couldn't be allocated (no parts, or price > à la carte) — in which
 * case the lines come back undiscounted so the rep still gets the bundle.
 */
export function expandPackageWithBundlePrice(
  components: PackageComponent[],
  packagePrice: number | string | null | undefined,
): { lines: ExpandedQuoteLine[]; allocated: boolean; error: string | null; saving: number | null } {
  const lines = componentsToQuoteLines(components);

  const raw = packagePrice == null ? "" : String(packagePrice).trim();
  const price = raw === "" ? null : Number(raw);
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return { lines, allocated: false, error: null, saving: null };
  }

  // Basis = each part line's extended sell value; allocate the bundle price
  // across only the item lines, remembering their positions.
  const itemIdx: number[] = [];
  const allocInput: { sku: string; quantity: number; alacarteCostCents: number }[] = [];
  lines.forEach((l, i) => {
    if (l.kind === "item") {
      itemIdx.push(i);
      allocInput.push({
        sku: l.description || `line ${i + 1}`,
        quantity: l.quantity || 0,
        alacarteCostCents: Math.round((l.unitPrice || 0) * 100),
      });
    }
  });
  if (allocInput.length === 0) {
    return { lines, allocated: false, error: "This package has no part lines to apply a bundle price to.", saving: null };
  }

  const result = allocatePromo(Math.round(price * 100), allocInput);
  if (!result.ok) {
    return { lines, allocated: false, error: result.error, saving: null };
  }

  const out: ExpandedQuoteLine[] = lines.map((l) => ({ ...l }));
  result.lines.forEach((al, k) => {
    const idx = itemIdx[k];
    const line = out[idx];
    if (line.kind === "item") {
      const grossCents = Math.round((line.unitPrice || 0) * 100) * (line.quantity || 0);
      const discCents = Math.max(0, grossCents - al.allocatedExtendedCents);
      line.discount = Math.round(discCents) / 100;
      line.discountKind = "amt";
    }
  });
  return { lines: out, allocated: true, error: null, saving: result.savingCents / 100 };
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
