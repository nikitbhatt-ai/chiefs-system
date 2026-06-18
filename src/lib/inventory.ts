// Centralized, transactional inventory movements.
//
// Every operation that touches stock (FIFO receipt layers + parts.quantity_on_hand
// + cost history) runs inside a single DB transaction and locks the controlling
// row FOR UPDATE so concurrent callers (double-clicks, two browser tabs, a
// deal-driven sync racing a workflow-board move) can never double-apply.
//
// Invariants this module guarantees:
//   - parts.quantity_on_hand never goes below zero (floored).
//   - FIFO consumption is idempotent per work order (work_orders.parts_consumed
//     is the latch; a second call is a no-op).
//   - Consumption is reversible: walking a build back out of in_progress (or
//     cancelling it) restores the exact receipt layers it drained, capped at
//     each layer's original received quantity.
//   - PO receiving is idempotent under concurrency: the PO row is locked and
//     re-read inside the transaction, so two simultaneous receives can't both
//     read a stale quantity_received and double-increment stock.

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  workOrders,
  quotes,
  parts,
  partReceipts,
  partCostHistory,
  purchaseOrders,
  type POLineItem,
} from "@/db/schema";

type StockLine = { kind?: string; partId?: string; quantity?: number };

// Roll a quote's line items up to a quantity-per-part map. Free-form lines
// (no partId) and fee/non-item lines are ignored. Repeated SKUs are summed so
// we issue one stock movement per part.
function rollupPartQuantities(lineItems: unknown): Map<string, number> {
  const lines = (lineItems as StockLine[] | null) ?? [];
  const byPart = new Map<string, number>();
  for (const line of lines) {
    if (line?.kind !== "item" || !line.partId) continue;
    const qty = Number(line.quantity || 0);
    if (qty > 0) byPart.set(line.partId, (byPart.get(line.partId) ?? 0) + qty);
  }
  return byPart;
}

export type ConsumeResult = {
  // true when this call performed the consumption; false when it was a no-op
  // (already consumed, or work order / quote not found).
  consumed: boolean;
  // Parts whose receipt layers could not cover the required quantity. On-hand
  // is still floored at zero; the shortage is surfaced so callers can warn.
  shortages: { partId: string; shortBy: number }[];
};

// Idempotent, transactional FIFO consumption of a work order's quote parts.
// Locks the work_orders row FOR UPDATE; if parts_consumed is already true this
// is a no-op. Drains oldest receipt layers first and decrements on-hand,
// flooring at zero so inventory can never go negative.
export async function consumeWorkOrderParts(workOrderId: string): Promise<ConsumeResult> {
  return db.transaction(async (tx) => {
    const [wo] = await tx
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for("update");
    if (!wo) return { consumed: false, shortages: [] };
    if (wo.partsConsumed) return { consumed: false, shortages: [] };

    let byPart = new Map<string, number>();
    if (wo.quoteId) {
      const [q] = await tx
        .select({ lineItems: quotes.lineItems })
        .from(quotes)
        .where(eq(quotes.id, wo.quoteId));
      byPart = rollupPartQuantities(q?.lineItems);
    }

    const shortages: { partId: string; shortBy: number }[] = [];
    for (const [partId, qty] of byPart) {
      const layers = await tx
        .select()
        .from(partReceipts)
        .where(eq(partReceipts.partId, partId))
        .orderBy(asc(partReceipts.receivedAt))
        .for("update");
      let need = qty;
      for (const layer of layers) {
        if (need <= 0) break;
        if (layer.quantityRemaining <= 0) continue;
        const take = Math.min(need, layer.quantityRemaining);
        await tx
          .update(partReceipts)
          .set({ quantityRemaining: layer.quantityRemaining - take })
          .where(eq(partReceipts.id, layer.id));
        need -= take;
      }
      if (need > 0) shortages.push({ partId, shortBy: need });
      // Floor at zero — never let physical on-hand go negative even if the
      // receipt ledger couldn't fully cover the build.
      await tx
        .update(parts)
        .set({
          quantityOnHand: sql`GREATEST(0, ${parts.quantityOnHand} - ${qty})`,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, partId));
    }

    await tx
      .update(workOrders)
      .set({ partsConsumed: true, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
    return { consumed: true, shortages };
  });
}

// Reverse a previous consumption — used when a build is walked back before
// in_progress or cancelled. Idempotent: a no-op unless parts_consumed is true.
// Refills the oldest layers first, capped at each layer's original received
// quantity, so it exactly undoes what consumeWorkOrderParts drained (assuming
// no intervening receipts on the same layers).
export async function restoreWorkOrderParts(workOrderId: string): Promise<{ restored: boolean }> {
  return db.transaction(async (tx) => {
    const [wo] = await tx
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for("update");
    if (!wo || !wo.partsConsumed) return { restored: false };

    let byPart = new Map<string, number>();
    if (wo.quoteId) {
      const [q] = await tx
        .select({ lineItems: quotes.lineItems })
        .from(quotes)
        .where(eq(quotes.id, wo.quoteId));
      byPart = rollupPartQuantities(q?.lineItems);
    }

    for (const [partId, qty] of byPart) {
      const layers = await tx
        .select()
        .from(partReceipts)
        .where(eq(partReceipts.partId, partId))
        .orderBy(asc(partReceipts.receivedAt))
        .for("update");
      let give = qty;
      for (const layer of layers) {
        if (give <= 0) break;
        const room = layer.quantityReceived - layer.quantityRemaining;
        if (room <= 0) continue;
        const add = Math.min(give, room);
        await tx
          .update(partReceipts)
          .set({ quantityRemaining: layer.quantityRemaining + add })
          .where(eq(partReceipts.id, layer.id));
        give -= add;
      }
      await tx
        .update(parts)
        .set({
          quantityOnHand: sql`${parts.quantityOnHand} + ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, partId));
    }

    await tx
      .update(workOrders)
      .set({ partsConsumed: false, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
    return { restored: true };
  });
}

// Transactional, concurrency-safe PO receiving. `receiveByIndex` maps a line
// index to the quantity received this round. The PO row is locked FOR UPDATE
// and its line items re-read inside the transaction, so two simultaneous
// receives serialize instead of both reading quantity_received = 0 and
// double-incrementing stock. Each received line appends a FIFO receipt layer,
// bumps on-hand, and logs a cost-history row — all or nothing.
export async function receivePurchaseOrder(
  purchaseOrderId: string,
  receiveByIndex: Map<number, number>,
): Promise<{ ok: boolean; status?: string; anyReceived?: boolean }> {
  return db.transaction(async (tx) => {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .for("update");
    if (!po) return { ok: false };

    const lines = (po.lineItems as POLineItem[]) ?? [];
    const updatedLines: POLineItem[] = [];
    let allFullyReceived = true;
    let anyReceivedThisRound = false;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const receiveNow = receiveByIndex.get(i) ?? 0;
      const remaining = (l.quantity || 0) - (l.quantityReceived || 0);
      const qty = Math.max(0, Math.min(receiveNow, remaining));
      if (qty > 0 && l.partId) {
        anyReceivedThisRound = true;
        await tx.insert(partReceipts).values({
          partId: l.partId,
          purchaseOrderId: po.id,
          vendorId: po.vendorId ?? null,
          quantityReceived: qty,
          quantityRemaining: qty,
          unitCost: String(l.unitCost),
        });
        await tx
          .update(parts)
          .set({
            quantityOnHand: sql`${parts.quantityOnHand} + ${qty}`,
            updatedAt: new Date(),
          })
          .where(eq(parts.id, l.partId));
        await tx.insert(partCostHistory).values({
          partId: l.partId,
          cost: String(l.unitCost),
          source: po.poNumber ?? "PO",
        });
      }
      const newReceived = (l.quantityReceived || 0) + qty;
      if (newReceived < (l.quantity || 0)) allFullyReceived = false;
      updatedLines.push({ ...l, quantityReceived: newReceived });
    }

    const nextStatus = allFullyReceived
      ? ("received" as const)
      : anyReceivedThisRound
        ? ("partially_received" as const)
        : po.status;

    await tx
      .update(purchaseOrders)
      .set({
        lineItems: updatedLines as never,
        status: nextStatus,
        receivedAt: allFullyReceived ? new Date() : po.receivedAt,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, purchaseOrderId));

    return { ok: true, status: nextStatus, anyReceived: anyReceivedThisRound };
  });
}
