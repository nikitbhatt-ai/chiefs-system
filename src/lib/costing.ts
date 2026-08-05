// Costing spine — Phase 2 of the promo-package build.
//
// The layer table (part_receipts) is the subledger of record for QUANTITY and
// PROVENANCE under both costing methods. What differs by method is only the
// dollar amount CHARGED to a job when parts are issued:
//   • weighted_average (primary): qty × parts.avg_cost
//   • fifo (secondary):            Σ over the actually-drained layer slices
// Either way, issuing drains the oldest layers first (so provenance + on-hand
// stay honest) and writes one inventory_issue row per layer slice at that
// layer's unit_cost. Phase 7 reads those rows to tell package cost from
// full-price cost — a distinction weighted average smears away in the GL.
//
// avg_cost is a moving average maintained inside the receive transaction:
//   new_avg = (on_hand_before × old_avg + received_qty × unit_cost)
//             / (on_hand_before + received_qty)
// and parts.cost follows it at 2dp (= ROUND(avg_cost, 2)). Both move at
// RECEIPT, never at PO entry.

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  parts,
  partReceipts,
  partCostHistory,
  inventoryIssue,
  costingPolicy,
  inventorySourceKind,
} from "@/db/schema";
import { dollarsToCents } from "@/lib/accounting";
import { postInventoryIssue } from "@/lib/inventoryLedger";
import { availableForPart } from "@/lib/reservations";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SourceKind = (typeof inventorySourceKind.enumValues)[number];
export type CostingMethod = "weighted_average" | "fifo";

// ── Costing policy ────────────────────────────────────────────────────────────

/** Active costing method. Defaults to weighted_average if the policy row is absent. */
export async function getCostingMethod(): Promise<CostingMethod> {
  const [row] = await db.select({ method: costingPolicy.method }).from(costingPolicy).limit(1);
  return (row?.method as CostingMethod) ?? "weighted_average";
}

/** Active costing method, read inside a caller's transaction. */
export async function getCostingMethodTx(tx: Tx): Promise<CostingMethod> {
  const [row] = await tx.select({ method: costingPolicy.method }).from(costingPolicy).limit(1);
  return (row?.method as CostingMethod) ?? "weighted_average";
}

/**
 * Set the active costing method. A change in accounting policy: it applies
 * forward only and never rewrites posted entries. Upserts the single policy row.
 */
export async function setCostingMethod(method: CostingMethod, changedBy?: string | null) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(costingPolicy).limit(1).for("update");
    if (existing) {
      await tx
        .update(costingPolicy)
        .set({ method, changedBy: changedBy ?? null, changedAt: new Date() })
        .where(eq(costingPolicy.id, existing.id));
    } else {
      await tx.insert(costingPolicy).values({ method, changedBy: changedBy ?? null });
    }
  });
}

// ── Receipt: layer + moving average ─────────────────────────────────────────────

/**
 * Record one received cost layer and roll the moving average, inside a caller's
 * transaction. Inserts the part_receipts layer, bumps parts.quantity_on_hand,
 * recomputes parts.avg_cost, and refreshes parts.cost = ROUND(avg_cost, 2).
 * Does NOT post the ledger — the caller batches the receipt journal entry so a
 * whole PO receive is one entry. Locks the part row FOR UPDATE so a concurrent
 * receive of the same SKU can't read a stale on-hand for the average.
 */
export async function recordReceiptLayer(
  tx: Tx,
  opts: {
    partId: string;
    quantityReceived: number;
    unitCost: number | string; // dollars
    sourceKind?: SourceKind;
    promoId?: string | null;
    purchaseOrderId?: string | null;
    vendorId?: string | null;
    receiptKey?: string | null;
    /** When set, writes a part_cost_history audit row (e.g. the PO number). */
    costHistorySource?: string | null;
  },
): Promise<{ layerId: string; newAvgCost: number }> {
  const qty = Math.max(0, Math.trunc(opts.quantityReceived));
  const unitCost = Number(opts.unitCost);
  const unitCostStr = Number.isFinite(unitCost) ? unitCost.toFixed(2) : "0.00";

  const [part] = await tx
    .select({ onHand: parts.quantityOnHand, avgCost: parts.avgCost, cost: parts.cost })
    .from(parts)
    .where(eq(parts.id, opts.partId))
    .for("update");

  const onHandBefore = part?.onHand ?? 0;
  const oldAvg = part?.avgCost != null ? Number(part.avgCost) : part?.cost != null ? Number(part.cost) : null;

  const [layer] = await tx
    .insert(partReceipts)
    .values({
      partId: opts.partId,
      purchaseOrderId: opts.purchaseOrderId ?? null,
      vendorId: opts.vendorId ?? null,
      sourceKind: opts.sourceKind ?? "individual",
      promoId: opts.promoId ?? null,
      quantityReceived: qty,
      quantityRemaining: qty,
      unitCost: unitCostStr,
      receiptKey: opts.receiptKey ?? null,
    })
    .returning({ id: partReceipts.id });

  // Moving average. With no prior stock (or no prior cost basis) the average is
  // simply this receipt's unit cost.
  const denom = onHandBefore + qty;
  let newAvg: number;
  if (denom <= 0) newAvg = unitCost;
  else if (oldAvg == null || onHandBefore <= 0) newAvg = unitCost;
  else newAvg = (onHandBefore * oldAvg + qty * unitCost) / denom;

  await tx
    .update(parts)
    .set({
      quantityOnHand: sql`${parts.quantityOnHand} + ${qty}`,
      avgCost: newAvg.toFixed(4),
      cost: newAvg.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(parts.id, opts.partId));

  if (opts.costHistorySource) {
    await tx.insert(partCostHistory).values({
      partId: opts.partId,
      cost: unitCostStr,
      source: opts.costHistorySource,
    });
  }

  return { layerId: layer.id, newAvgCost: newAvg };
}

// ── Issue: drain layers oldest-first ────────────────────────────────────────────

export type DrainResult = {
  /** Units actually drawn from layers (≤ requested). */
  taken: number;
  /** Requested − taken; > 0 when layers couldn't cover the draw. */
  shortBy: number;
  /** Real FIFO cost of what was drawn, in integer cents. */
  fifoCents: number;
};

/**
 * Drain `qty` units of a part from its oldest layers, writing one
 * inventory_issue row per slice at that layer's unit_cost. Decrements each
 * layer's remaining_qty. Does NOT touch parts.quantity_on_hand or post a ledger
 * entry — the caller owns those so a multi-part issue posts one journal entry.
 * Locks the layers FOR UPDATE.
 */
export async function drainLayersTx(
  tx: Tx,
  opts: { partId: string; qty: number; workOrderId?: string | null },
): Promise<DrainResult> {
  const layers = await tx
    .select()
    .from(partReceipts)
    .where(eq(partReceipts.partId, opts.partId))
    .orderBy(asc(partReceipts.receivedAt))
    .for("update");

  let need = Math.max(0, Math.trunc(opts.qty));
  const requested = need;
  let fifoCents = 0;
  for (const layer of layers) {
    if (need <= 0) break;
    if (layer.quantityRemaining <= 0) continue;
    const take = Math.min(need, layer.quantityRemaining);
    await tx
      .update(partReceipts)
      .set({ quantityRemaining: layer.quantityRemaining - take })
      .where(eq(partReceipts.id, layer.id));
    await tx.insert(inventoryIssue).values({
      partId: opts.partId,
      workOrderId: opts.workOrderId ?? null,
      layerId: layer.id,
      qty: take,
      unitCost: layer.unitCost,
    });
    fifoCents += take * dollarsToCents(layer.unitCost);
    need -= take;
  }
  return { taken: requested - need, shortBy: need, fifoCents };
}

/**
 * Reverse every issue this work order made for a part: add each slice's qty back
 * to its layer (capped at the layer's received qty) and delete the issue rows.
 * Returns units returned and their FIFO cents. Precise — it undoes exactly what
 * drainLayersTx recorded.
 */
export async function reverseIssuesTx(
  tx: Tx,
  opts: { partId: string; workOrderId: string },
): Promise<{ given: number; fifoCents: number }> {
  const issues = await tx
    .select()
    .from(inventoryIssue)
    .where(and(eq(inventoryIssue.partId, opts.partId), eq(inventoryIssue.workOrderId, opts.workOrderId)));

  let given = 0;
  let fifoCents = 0;
  for (const iss of issues) {
    if (iss.layerId) {
      await tx
        .update(partReceipts)
        .set({
          quantityRemaining: sql`LEAST(${partReceipts.quantityReceived}, ${partReceipts.quantityRemaining} + ${iss.qty})`,
        })
        .where(eq(partReceipts.id, iss.layerId));
    }
    given += iss.qty;
    fifoCents += iss.qty * dollarsToCents(iss.unitCost);
  }
  await tx
    .delete(inventoryIssue)
    .where(and(eq(inventoryIssue.partId, opts.partId), eq(inventoryIssue.workOrderId, opts.workOrderId)));
  return { given, fifoCents };
}

/**
 * The cost CHARGED to a job for `qty` units, given the real FIFO cents drawn and
 * the part's average cost, under a costing method. Weighted average charges
 * qty × avg_cost; FIFO charges the actual layer cost. Falls back to FIFO cents
 * when avg_cost is unknown.
 */
export function chargeCents(
  method: CostingMethod,
  opts: { qty: number; fifoCents: number; avgCost: number | string | null },
): number {
  if (method === "fifo") return opts.fifoCents;
  const avg = opts.avgCost == null ? null : Number(opts.avgCost);
  if (avg == null || !Number.isFinite(avg)) return opts.fifoCents;
  return Math.round(opts.qty * avg * 100);
}

/**
 * General single-part issue — the "issue(sku, qty, workOrderId?)" the brief
 * asks for. Drains oldest layers, decrements on-hand, and (when tied to a work
 * order) posts Dr WIP / Cr Inventory at the method-aware charge. STRICT: issuing
 * more than the layers hold throws and rolls the whole thing back. Accepts a
 * partId or a sku.
 */
export async function issueStock(opts: {
  partId?: string;
  sku?: string;
  qty: number;
  workOrderId?: string | null;
  woNumber?: string | null;
  createdBy?: string | null;
  // Phase 5/6: by default the pull is gated to available (on-hand − reserved by
  // OTHER work orders). Pulling reserved stock requires allowReserved = true,
  // which the Phase 6 override path sets after logging who/why.
  allowReserved?: boolean;
}): Promise<{ partId: string; taken: number; chargeCents: number }> {
  const qty = Math.max(0, Math.trunc(opts.qty));
  if (qty <= 0) throw new Error("Issue quantity must be greater than zero.");

  return db.transaction(async (tx) => {
    let partId = opts.partId ?? null;
    let avgCost: string | null = null;
    if (!partId && opts.sku) {
      const [p] = await tx
        .select({ id: parts.id, avgCost: parts.avgCost })
        .from(parts)
        .where(eq(parts.sku, opts.sku))
        .for("update");
      if (!p) throw new Error(`No part with SKU ${opts.sku}.`);
      partId = p.id;
      avgCost = p.avgCost;
    } else if (partId) {
      const [p] = await tx
        .select({ avgCost: parts.avgCost })
        .from(parts)
        .where(eq(parts.id, partId))
        .for("update");
      avgCost = p?.avgCost ?? null;
    }
    if (!partId) throw new Error("issueStock needs a partId or sku.");

    // Available-to-pull gate: a walk-in / non-owning pull can't touch stock
    // reserved for other builds unless an override says so (Phase 6).
    if (!opts.allowReserved) {
      const avail = await availableForPart(partId, { excludeWorkOrderId: opts.workOrderId ?? null, tx });
      if (qty > avail) {
        throw new Error(
          `Only ${Math.max(0, avail)} available to pull (the rest is reserved for other builds). ` +
            `Pulling reserved stock requires an override.`,
        );
      }
    }

    const method = await getCostingMethodTx(tx);
    const drain = await drainLayersTx(tx, { partId, qty, workOrderId: opts.workOrderId ?? null });
    if (drain.shortBy > 0) {
      throw new Error(`Not enough stock to issue: short by ${drain.shortBy}.`);
    }

    await tx
      .update(parts)
      .set({ quantityOnHand: sql`GREATEST(0, ${parts.quantityOnHand} - ${drain.taken})`, updatedAt: new Date() })
      .where(eq(parts.id, partId));

    const charge = chargeCents(method, { qty: drain.taken, fifoCents: drain.fifoCents, avgCost });
    if (opts.workOrderId) {
      await postInventoryIssue(tx, {
        totalCents: charge,
        workOrderId: opts.workOrderId,
        woNumber: opts.woNumber ?? null,
        createdBy: opts.createdBy ?? null,
      });
    }
    return { partId, taken: drain.taken, chargeCents: charge };
  });
}
