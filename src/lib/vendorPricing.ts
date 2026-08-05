// Vendor à la carte price list — Phase 1 of the promo-package build.
//
// This is the single source of truth for what a part costs when bought
// individually from a vendor. Two consumers downstream:
//   • Phase 3 allocation basis — a promo line snapshots the current à la carte
//     cost, and the package price is spread in proportion to it.
//   • Phase 4 individual-PO pre-fill — a full-price PO line pre-fills from HERE,
//     not from parts.cost, because parts.cost tracks the average and drifts
//     below à la carte once discounted package stock lands.
//
// Prices are date-ranged and append-only. The "current" price is the row whose
// [effective_from, effective_to) window covers today; effective_to IS NULL
// means still current. A partial unique index guarantees at most one current
// row per (vendor, sku), so setCurrentPrice can rely on there being one to
// close.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { vendorPartPrice } from "@/db/schema";

export type PriceRow = typeof vendorPartPrice.$inferSelect;

/**
 * Current à la carte unit cost for a (vendor, sku), as a number, or null if no
 * current price exists. "Current" = the single row with effective_to IS NULL.
 * effective_from is not re-checked against today here: a row is made current at
 * the moment it is written, so a future-dated effective_from is not a supported
 * state — prices take effect when entered.
 */
export async function currentAlacarteCost(vendorId: string, sku: string): Promise<number | null> {
  const [row] = await db
    .select({ cost: vendorPartPrice.alacarteUnitCost })
    .from(vendorPartPrice)
    .where(
      and(
        eq(vendorPartPrice.vendorId, vendorId),
        eq(vendorPartPrice.sku, sku),
        isNull(vendorPartPrice.effectiveTo),
      ),
    )
    .limit(1);
  return row ? Number(row.cost) : null;
}

/** The current price row (full record) for a (vendor, sku), or null. */
export async function currentPriceRow(vendorId: string, sku: string): Promise<PriceRow | null> {
  const [row] = await db
    .select()
    .from(vendorPartPrice)
    .where(
      and(
        eq(vendorPartPrice.vendorId, vendorId),
        eq(vendorPartPrice.sku, sku),
        isNull(vendorPartPrice.effectiveTo),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Full price history for a (vendor, sku), newest first. */
export async function priceHistory(vendorId: string, sku: string): Promise<PriceRow[]> {
  return db
    .select()
    .from(vendorPartPrice)
    .where(and(eq(vendorPartPrice.vendorId, vendorId), eq(vendorPartPrice.sku, sku)))
    .orderBy(desc(vendorPartPrice.effectiveFrom), desc(vendorPartPrice.createdAt));
}

/**
 * Set the current à la carte cost for a (vendor, sku), preserving history.
 *
 * Transactional: closes any existing current row (effective_to = today) and
 * inserts a new current row (effective_from = today, effective_to = null). If
 * the incoming cost equals the current one this is a no-op that returns the
 * existing row — no spurious history churn. Locks the current row FOR UPDATE so
 * two concurrent writers can't both insert a second null-effective_to row and
 * trip the partial unique index.
 *
 * cost is accepted as a number or string and normalized to a 2-decimal string
 * for the numeric column, so callers never hand raw floats to the DB.
 */
export async function setCurrentPrice(input: {
  vendorId: string;
  sku: string;
  cost: number | string;
  sourceNote?: string | null;
}): Promise<{ row: PriceRow; changed: boolean }> {
  const sku = input.sku.trim();
  const costStr = normalizeCost(input.cost);
  if (costStr == null) throw new Error("cost must be a non-negative number");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(vendorPartPrice)
      .where(
        and(
          eq(vendorPartPrice.vendorId, input.vendorId),
          eq(vendorPartPrice.sku, sku),
          isNull(vendorPartPrice.effectiveTo),
        ),
      )
      .for("update");

    // No change in the actual number → leave history untouched.
    if (existing && Number(existing.alacarteUnitCost) === Number(costStr)) {
      return { row: existing, changed: false };
    }

    if (existing) {
      await tx
        .update(vendorPartPrice)
        .set({ effectiveTo: sql`CURRENT_DATE`, updatedAt: new Date() })
        .where(eq(vendorPartPrice.id, existing.id));
    }

    const [row] = await tx
      .insert(vendorPartPrice)
      .values({
        vendorId: input.vendorId,
        sku,
        alacarteUnitCost: costStr,
        sourceNote: input.sourceNote?.trim() || null,
      })
      .returning();
    return { row, changed: true };
  });
}

/** Normalize a money input to a 2-decimal string, or null if invalid/negative. */
export function normalizeCost(v: number | string): string | null {
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}
