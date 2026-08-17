// Centralized, transactional inventory movements.
//
// Every operation that touches stock (cost layers + parts.quantity_on_hand +
// the moving average + cost history) runs inside a single DB transaction and
// locks the controlling row FOR UPDATE so concurrent callers (double-clicks,
// two browser tabs, a deal-driven sync racing a workflow-board move) can never
// double-apply.
//
// Costing (Phase 2) lives in src/lib/costing.ts and is called from here:
//   - Receiving rolls parts.avg_cost as a moving average and refreshes
//     parts.cost = ROUND(avg_cost, 2). The ledger values receipts at actual PO
//     unit cost (Dr Inventory / Cr AP).
//   - Issuing drains oldest layers first (writing inventory_issue provenance
//     rows) but charges the job at the ACTIVE costing method — weighted average
//     by default, FIFO if the policy says so.
//
// Invariants:
//   - parts.quantity_on_hand never goes below zero (floored).
//   - Consumption is idempotent per work order (work_orders.parts_consumed is
//     the latch; a second call is a no-op).
//   - Consumption is reversible: walking a build back restores the exact
//     inventory_issue slices it drained (with a legacy fallback for work orders
//     consumed before Phase 2, which have no issue rows).
//   - PO receiving is idempotent under concurrency: the PO row is locked and
//     re-read inside the transaction.

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  workOrders,
  quotes,
  parts,
  partReceipts,
  inventoryIssue,
  purchaseOrders,
  backfillRequisition,
  type POLineItem,
} from "@/db/schema";
import { and } from "drizzle-orm";
import { dollarsToCents } from "@/lib/accounting";
import { postInventoryReceipt, postInventoryIssue, postInventoryRestore } from "@/lib/inventoryLedger";
import {
  recordReceiptLayer,
  drainLayersTx,
  reverseIssuesTx,
  chargeCents,
  getCostingMethodTx,
} from "@/lib/costing";

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
  // Parts whose cost layers could not cover the required quantity. On-hand is
  // still floored at zero; the shortage is surfaced so callers can warn.
  shortages: { partId: string; shortBy: number }[];
};

// Idempotent, transactional consumption of a work order's quote parts. Locks the
// work_orders row FOR UPDATE; if parts_consumed is already true this is a no-op.
// Drains the oldest layers first (writing inventory_issue provenance rows),
// decrements on-hand by what actually left the layers, and charges WIP at the
// active costing method.
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

    const method = await getCostingMethodTx(tx);
    const shortages: { partId: string; shortBy: number }[] = [];
    // Cost charged to the job under the active method (avg by default, FIFO
    // otherwise). The layer drain preserves provenance regardless.
    let chargeTotalCents = 0;
    for (const [partId, qty] of byPart) {
      const [p] = await tx.select({ avgCost: parts.avgCost }).from(parts).where(eq(parts.id, partId));
      const drain = await drainLayersTx(tx, { partId, qty, workOrderId: wo.id });
      if (drain.shortBy > 0) shortages.push({ partId, shortBy: drain.shortBy });
      chargeTotalCents += chargeCents(method, {
        qty: drain.taken,
        fifoCents: drain.fifoCents,
        avgCost: p?.avgCost ?? null,
      });
      // Decrement on-hand by what actually left the layers, flooring at zero so
      // physical stock can never go negative.
      await tx
        .update(parts)
        .set({
          quantityOnHand: sql`GREATEST(0, ${parts.quantityOnHand} - ${drain.taken})`,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, partId));
    }

    // Ledger: Dr Work in Progress / Cr Inventory at the method-aware charge.
    await postInventoryIssue(tx, { totalCents: chargeTotalCents, workOrderId: wo.id, woNumber: wo.woNumber });

    await tx
      .update(workOrders)
      .set({ partsConsumed: true, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
    return { consumed: true, shortages };
  });
}

// Reverse a previous consumption — used when a build is walked back before
// in_progress or cancelled. Idempotent: a no-op unless parts_consumed is true.
// Prefers precise reversal of the recorded inventory_issue slices; falls back to
// the quote rollup for work orders consumed before Phase 2 (no issue rows).
export async function restoreWorkOrderParts(workOrderId: string): Promise<{ restored: boolean }> {
  return db.transaction(async (tx) => {
    const [wo] = await tx
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .for("update");
    if (!wo || !wo.partsConsumed) return { restored: false };

    const method = await getCostingMethodTx(tx);
    let chargeTotalCents = 0;

    const issued = await tx
      .selectDistinct({ partId: inventoryIssue.partId })
      .from(inventoryIssue)
      .where(eq(inventoryIssue.workOrderId, wo.id));

    if (issued.length > 0) {
      // Precise path: undo exactly what was issued.
      for (const { partId } of issued) {
        const [p] = await tx.select({ avgCost: parts.avgCost }).from(parts).where(eq(parts.id, partId));
        const rev = await reverseIssuesTx(tx, { partId, workOrderId: wo.id });
        chargeTotalCents += chargeCents(method, { qty: rev.given, fifoCents: rev.fifoCents, avgCost: p?.avgCost ?? null });
        await tx
          .update(parts)
          .set({ quantityOnHand: sql`${parts.quantityOnHand} + ${rev.given}`, updatedAt: new Date() })
          .where(eq(parts.id, partId));
      }
    } else {
      // Legacy fallback: pre-Phase-2 consumption left no issue rows. Refill the
      // oldest layers first (capped at each layer's received qty) from the quote
      // rollup, exactly as the old code did.
      let byPart = new Map<string, number>();
      if (wo.quoteId) {
        const [q] = await tx.select({ lineItems: quotes.lineItems }).from(quotes).where(eq(quotes.id, wo.quoteId));
        byPart = rollupPartQuantities(q?.lineItems);
      }
      for (const [partId, qty] of byPart) {
        const [p] = await tx.select({ avgCost: parts.avgCost }).from(parts).where(eq(parts.id, partId));
        const layers = await tx
          .select()
          .from(partReceipts)
          .where(eq(partReceipts.partId, partId))
          .orderBy(asc(partReceipts.receivedAt))
          .for("update");
        let give = qty;
        let fifoCents = 0;
        for (const layer of layers) {
          if (give <= 0) break;
          const room = layer.quantityReceived - layer.quantityRemaining;
          if (room <= 0) continue;
          const add = Math.min(give, room);
          await tx
            .update(partReceipts)
            .set({ quantityRemaining: layer.quantityRemaining + add })
            .where(eq(partReceipts.id, layer.id));
          fifoCents += add * dollarsToCents(layer.unitCost);
          give -= add;
        }
        const returned = qty - give;
        chargeTotalCents += chargeCents(method, { qty: returned, fifoCents, avgCost: p?.avgCost ?? null });
        await tx
          .update(parts)
          .set({ quantityOnHand: sql`${parts.quantityOnHand} + ${returned}`, updatedAt: new Date() })
          .where(eq(parts.id, partId));
      }
    }

    // Ledger: Dr Inventory / Cr Work in Progress — undo the issue at the same method-aware cost.
    await postInventoryRestore(tx, { totalCents: chargeTotalCents, workOrderId: wo.id, woNumber: wo.woNumber });

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
// double-incrementing stock. Each received line appends a cost layer, rolls the
// moving average, bumps on-hand, and logs a cost-history row — all or nothing.
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
    // Value of goods received this round at ACTUAL PO unit cost, for the ledger.
    let receivedCents = 0;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const receiveNow = receiveByIndex.get(i) ?? 0;
      const remaining = (l.quantity || 0) - (l.quantityReceived || 0);
      const qty = Math.max(0, Math.min(receiveNow, remaining));
      const newReceived = (l.quantityReceived || 0) + qty;
      if (qty > 0 && l.partId) {
        // Idempotency: a stable per-line, per-cumulative-quantity key. A replayed
        // receipt computes the same key and is skipped (the partial unique index
        // on part_receipts.receipt_key is the DB backstop).
        const lineId = l.id ?? `idx${i}`;
        const receiptKey = `${po.id}:${lineId}:${newReceived}`;
        const [dupe] = await tx
          .select({ id: partReceipts.id })
          .from(partReceipts)
          .where(eq(partReceipts.receiptKey, receiptKey))
          .limit(1);
        if (!dupe) {
          anyReceivedThisRound = true;
          receivedCents += qty * dollarsToCents(l.unitCost);
          // Package lines land as `package` layers carrying their promo id (for
          // Phase 7); backfill lines as `backfill`; everything else individual.
          const sourceKind = l.sourceKind ?? (l.sourcePromoId ? "package" : "individual");
          // Layer + moving average + parts.cost + cost history, in one place.
          await recordReceiptLayer(tx, {
            partId: l.partId,
            quantityReceived: qty,
            unitCost: l.unitCost,
            sourceKind,
            promoId: l.sourcePromoId ?? null,
            purchaseOrderId: po.id,
            vendorId: po.vendorId ?? null,
            receiptKey,
            costHistorySource: po.poNumber ?? "PO",
          });
        }
      }
      if (newReceived < (l.quantity || 0)) allFullyReceived = false;
      updatedLines.push({ ...l, quantityReceived: newReceived });
    }

    // All lines & quantities in → "fulfilled"; some in → "partially_received"
    // (shown as "Received"); nothing this round → leave the status as-is.
    const nextStatus = allFullyReceived
      ? ("fulfilled" as const)
      : anyReceivedThisRound
        ? ("partially_received" as const)
        : po.status;

    // Ledger: Dr Inventory / Cr Accounts Payable for the value received.
    await postInventoryReceipt(tx, { totalCents: receivedCents, poNumber: po.poNumber });

    await tx
      .update(purchaseOrders)
      .set({
        lineItems: updatedLines as never,
        status: nextStatus,
        receivedAt: allFullyReceived ? new Date() : po.receivedAt,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, purchaseOrderId));

    // Close the loop on any backfill requisition this PO was raised to fulfil
    // (Phase 6): once fully received, mark it received.
    if (allFullyReceived) {
      await tx
        .update(backfillRequisition)
        .set({ status: "received", updatedAt: new Date() })
        .where(and(eq(backfillRequisition.purchaseOrderId, po.id), eq(backfillRequisition.status, "ordered")));
    }

    return { ok: true, status: nextStatus, anyReceived: anyReceivedThisRound };
  });
}
