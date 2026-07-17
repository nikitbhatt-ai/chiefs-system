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
    };
  });
}

// Undiscounted value of a package — parts (qty × unit price) + labor
// (hours × rate) + fees. Shown as a reference figure in the builder and
// package list; the real total is recomputed on the quote after discounts
// and tax.
export function packageValue(components: PackageComponent[]): number {
  let total = 0;
  for (const c of components ?? []) {
    if (c.kind === "item") total += (c.quantity || 0) * (c.unitPrice || 0);
    else if (c.kind === "labor") total += (c.hours || 0) * (c.rate || 0);
    else total += c.amount || 0;
  }
  return total;
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
