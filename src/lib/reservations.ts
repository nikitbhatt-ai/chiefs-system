// Reservations + available-to-pull — Phase 5.
//
// A sold, committed build reserves the parts it needs. Reserving moves nothing
// physically — it records a claim. Available = on-hand − Σ active reservations,
// and that is what every picking/pull screen (and the general issueStock path)
// reads, so a walk-in job can't raid a sold build's parts.
//
// Lifecycle, driven from the workflow-stage move path and maybePromoteWonDeal:
//   confirmed (or awaiting_parts / next_in_line)  → reserveForWorkOrder (active)
//   in_progress (parts issued/consumed)           → fulfillReservations (claim realized)
//   back to estimate (de-committed)               → releaseReservations
// Only `active` rows count toward reserved; fulfilling avoids double-counting a
// consumed part (on-hand already dropped) and releasing frees the claim.

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryReservation, parts, quotes, workOrders } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

type QuoteLine = { kind?: string; partId?: string; quantity?: number };

function rollupPartQuantities(lineItems: unknown): Map<string, number> {
  const lines = (lineItems as QuoteLine[] | null) ?? [];
  const byPart = new Map<string, number>();
  for (const line of lines) {
    if (line?.kind !== "item" || !line.partId) continue;
    const qty = Number(line.quantity || 0);
    if (qty > 0) byPart.set(line.partId, (byPart.get(line.partId) ?? 0) + qty);
  }
  return byPart;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Active reserved quantity for a part. Optionally exclude one work order's own claim. */
export async function reservedForPart(
  partId: string,
  opts?: { excludeWorkOrderId?: string | null; tx?: Tx },
): Promise<number> {
  const runner: DbOrTx = opts?.tx ?? db;
  const filters = [eq(inventoryReservation.partId, partId), eq(inventoryReservation.status, "active")];
  if (opts?.excludeWorkOrderId) filters.push(ne(inventoryReservation.workOrderId, opts.excludeWorkOrderId));
  const [row] = await runner
    .select({ qty: sql<number>`COALESCE(SUM(${inventoryReservation.qtyReserved}), 0)`.mapWith(Number) })
    .from(inventoryReservation)
    .where(and(...filters));
  return row?.qty ?? 0;
}

/** On-hand − active reserved for a part. Optionally exclude one work order's own claim. */
export async function availableForPart(
  partId: string,
  opts?: { excludeWorkOrderId?: string | null; tx?: Tx },
): Promise<number> {
  const runner: DbOrTx = opts?.tx ?? db;
  const [p] = await runner.select({ onHand: parts.quantityOnHand }).from(parts).where(eq(parts.id, partId)).limit(1);
  const onHand = p?.onHand ?? 0;
  const reserved = await reservedForPart(partId, opts);
  return onHand - reserved;
}

/** Active reserved quantity keyed by partId, for list views (set-based, no N+1). */
export async function reservedByPart(partIds?: string[]): Promise<Map<string, number>> {
  const filters = [eq(inventoryReservation.status, "active")];
  if (partIds && partIds.length) filters.push(inArray(inventoryReservation.partId, partIds));
  const rows = await db
    .select({
      partId: inventoryReservation.partId,
      qty: sql<number>`COALESCE(SUM(${inventoryReservation.qtyReserved}), 0)`.mapWith(Number),
    })
    .from(inventoryReservation)
    .where(and(...filters))
    .groupBy(inventoryReservation.partId);
  return new Map(rows.map((r) => [r.partId, r.qty]));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Ensure this work order's reservations exist and are active, matching its
 * quote's current bill of materials. Idempotent and reactivating: an existing
 * row for (wo, part) is set active with the current qty; a part no longer on the
 * BOM is released; new parts get a fresh active row. Runs inside a caller tx.
 */
export async function reserveForWorkOrderTx(tx: Tx, workOrderId: string): Promise<{ reserved: number }> {
  const [wo] = await tx.select({ quoteId: workOrders.quoteId }).from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo?.quoteId) return { reserved: 0 };
  const [q] = await tx.select({ lineItems: quotes.lineItems }).from(quotes).where(eq(quotes.id, wo.quoteId));
  const byPart = rollupPartQuantities(q?.lineItems);

  const existing = await tx
    .select()
    .from(inventoryReservation)
    .where(eq(inventoryReservation.workOrderId, workOrderId));
  const existingByPart = new Map(existing.map((r) => [r.partId, r]));

  // SKUs for denormalization.
  const partIds = Array.from(byPart.keys());
  const skuRows = partIds.length
    ? await tx.select({ id: parts.id, sku: parts.sku }).from(parts).where(inArray(parts.id, partIds))
    : [];
  const skuById = new Map(skuRows.map((r) => [r.id, r.sku]));

  let reserved = 0;
  for (const [partId, qty] of byPart) {
    reserved += qty;
    const row = existingByPart.get(partId);
    if (row) {
      await tx
        .update(inventoryReservation)
        .set({ qtyReserved: qty, status: "active", sku: skuById.get(partId) ?? row.sku, updatedAt: new Date() })
        .where(eq(inventoryReservation.id, row.id));
    } else {
      await tx.insert(inventoryReservation).values({
        workOrderId,
        partId,
        sku: skuById.get(partId) ?? null,
        qtyReserved: qty,
        status: "active",
      });
    }
  }
  // Release any prior reservation whose part is no longer on the BOM.
  for (const row of existing) {
    if (!byPart.has(row.partId) && row.status !== "released") {
      await tx
        .update(inventoryReservation)
        .set({ status: "released", updatedAt: new Date() })
        .where(eq(inventoryReservation.id, row.id));
    }
  }
  return { reserved };
}

/** reserveForWorkOrderTx in its own transaction. */
export async function reserveForWorkOrder(workOrderId: string) {
  return db.transaction((tx) => reserveForWorkOrderTx(tx, workOrderId));
}

/** Mark a work order's active reservations fulfilled (parts issued/consumed). */
export async function fulfillReservationsForWorkOrder(workOrderId: string) {
  await db
    .update(inventoryReservation)
    .set({ status: "fulfilled", updatedAt: new Date() })
    .where(and(eq(inventoryReservation.workOrderId, workOrderId), eq(inventoryReservation.status, "active")));
}

/** Release a work order's reservations (build de-committed / walked back to estimate). */
export async function releaseReservationsForWorkOrder(workOrderId: string) {
  await db
    .update(inventoryReservation)
    .set({ status: "released", updatedAt: new Date() })
    .where(
      and(
        eq(inventoryReservation.workOrderId, workOrderId),
        inArray(inventoryReservation.status, ["active", "fulfilled"]),
      ),
    );
}
