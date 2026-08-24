// Reorder points, reserved-stock override, and auto-backfill — Phase 6.
//
// Two ways a backfill_requisition is raised:
//   • Reorder point — when a part's available (on-hand − reserved) drops to its
//     min_qty, raise an OPEN requisition for reorder_to_qty − available. The
//     ordinary replenishment path.
//   • Reserved override — pulling stock reserved for another build is impossible
//     without an explicit override. The override issues the stock, logs who/why
//     in stock_override_log, and immediately raises a requisition with need_by
//     set to the raided build's scheduled date so the borrow replaces itself.
//
// A requisition becomes an individual PO with source_kind = backfill on receipt
// (Phase 4 stamps the layer from the PO line's source_kind).

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  reorderPoint,
  stockOverrideLog,
  backfillRequisition,
  parts,
  quotes,
  workOrders,
  vendors,
  purchaseOrders,
  inventoryReservation,
  type POLineItem,
} from "@/db/schema";
import { availableForPart } from "@/lib/reservations";
import { issueStock } from "@/lib/costing";
import { currentAlacarteCost } from "@/lib/vendorPricing";
import { randomUUID } from "node:crypto";

// ── Reorder points ─────────────────────────────────────────────────────────────

export async function setReorderPoint(input: { partId: string; minQty: number; reorderToQty: number }) {
  const [p] = await db.select({ sku: parts.sku }).from(parts).where(eq(parts.id, input.partId)).limit(1);
  const minQty = Math.max(0, Math.trunc(input.minQty));
  const reorderToQty = Math.max(0, Math.trunc(input.reorderToQty));
  const [existing] = await db.select({ id: reorderPoint.id }).from(reorderPoint).where(eq(reorderPoint.partId, input.partId)).limit(1);
  if (existing) {
    await db
      .update(reorderPoint)
      .set({ minQty, reorderToQty, sku: p?.sku ?? null, updatedAt: new Date() })
      .where(eq(reorderPoint.id, existing.id));
  } else {
    await db.insert(reorderPoint).values({ partId: input.partId, sku: p?.sku ?? null, minQty, reorderToQty });
  }
}

export async function listReorderPoints() {
  const rows = await db
    .select({
      id: reorderPoint.id,
      partId: reorderPoint.partId,
      sku: parts.sku,
      name: parts.name,
      onHand: parts.quantityOnHand,
      minQty: reorderPoint.minQty,
      reorderToQty: reorderPoint.reorderToQty,
    })
    .from(reorderPoint)
    .leftJoin(parts, eq(parts.id, reorderPoint.partId))
    .orderBy(parts.sku);
  // Attach live available (on-hand − active reserved).
  const reserved = await activeReservedByPart(rows.map((r) => r.partId));
  return rows.map((r) => ({ ...r, available: (r.onHand ?? 0) - (reserved.get(r.partId) ?? 0) }));
}

async function activeReservedByPart(partIds: string[]): Promise<Map<string, number>> {
  if (!partIds.length) return new Map();
  const rows = await db
    .select({ partId: inventoryReservation.partId, qty: sql<number>`COALESCE(SUM(${inventoryReservation.qtyReserved}),0)`.mapWith(Number) })
    .from(inventoryReservation)
    .where(and(inArray(inventoryReservation.partId, partIds), eq(inventoryReservation.status, "active")))
    .groupBy(inventoryReservation.partId);
  return new Map(rows.map((r) => [r.partId, r.qty]));
}

// ── Reorder-point auto-backfill ──────────────────────────────────────────────

/**
 * If this part has a reorder point and its available has dropped to min_qty,
 * raise an OPEN requisition for reorder_to_qty − available — unless an open
 * reorder-point requisition already exists for it (dedup). Returns the new
 * requisition id, or null when nothing was raised.
 */
export async function maybeRaiseReorder(partId: string): Promise<string | null> {
  const [rp] = await db.select().from(reorderPoint).where(eq(reorderPoint.partId, partId)).limit(1);
  if (!rp) return null;

  const available = await availableForPart(partId);
  if (available > rp.minQty) return null;

  const qty = rp.reorderToQty - available;
  if (qty <= 0) return null;

  // Dedup: one open reorder-point requisition per part at a time.
  const [open] = await db
    .select({ id: backfillRequisition.id })
    .from(backfillRequisition)
    .where(
      and(
        eq(backfillRequisition.partId, partId),
        eq(backfillRequisition.triggeredBy, "reorder_point"),
        eq(backfillRequisition.status, "open"),
      ),
    )
    .limit(1);
  if (open) return null;

  const [row] = await db
    .insert(backfillRequisition)
    .values({ partId, sku: rp.sku, qty, triggeredBy: "reorder_point" })
    .returning({ id: backfillRequisition.id });
  return row?.id ?? null;
}

/** Run the reorder check for a set of parts (after their available dropped). */
export async function checkReordersForParts(partIds: string[]): Promise<number> {
  let raised = 0;
  for (const id of Array.from(new Set(partIds))) {
    if (await maybeRaiseReorder(id)) raised++;
  }
  return raised;
}

/** Reorder check for every part on a work order's quote BOM. Best-effort. */
export async function checkReordersForWorkOrder(workOrderId: string): Promise<number> {
  const [wo] = await db.select({ quoteId: workOrders.quoteId }).from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo?.quoteId) return 0;
  const [q] = await db.select({ lineItems: quotes.lineItems }).from(quotes).where(eq(quotes.id, wo.quoteId));
  const lines = (q?.lineItems as { kind?: string; partId?: string }[] | null) ?? [];
  const partIds = lines.filter((l) => l?.kind === "item" && l.partId).map((l) => l.partId as string);
  return checkReordersForParts(partIds);
}

/** Scan every part that has a reorder point. Returns how many requisitions were raised. */
export async function scanAllReorderPoints(): Promise<number> {
  const rows = await db.select({ partId: reorderPoint.partId }).from(reorderPoint);
  return checkReordersForParts(rows.map((r) => r.partId));
}

// ── Reserved-stock override ─────────────────────────────────────────────────────

/**
 * Pull stock reserved for other builds. Impossible without this call: it issues
 * the stock (bypassing the available gate), logs who/why, and raises a
 * self-tracking backfill requisition with need_by = the soonest scheduled date
 * among the builds whose reservation was raided.
 */
export async function overridePull(input: {
  partId: string;
  qty: number;
  reason: string;
  workOrderId?: string | null;
  userId?: string | null;
  woNumber?: string | null;
}): Promise<{ overrideId: string; requisitionId: string; issued: number }> {
  const qty = Math.max(0, Math.trunc(input.qty));
  if (qty <= 0) throw new Error("Override quantity must be greater than zero.");
  if (!input.reason?.trim()) throw new Error("An override needs a reason.");

  const [p] = await db.select({ sku: parts.sku }).from(parts).where(eq(parts.id, input.partId)).limit(1);

  // Issue the stock, bypassing the reserved gate. Throws (and changes nothing)
  // if there isn't even enough physical stock on hand.
  const result = await issueStock({
    partId: input.partId,
    qty,
    workOrderId: input.workOrderId ?? null,
    woNumber: input.woNumber ?? null,
    createdBy: input.userId ?? null,
    allowReserved: true,
  });

  // need_by = soonest scheduled build whose reservation we raided.
  const raided = await db
    .select({ target: workOrders.targetBuildStartDate })
    .from(inventoryReservation)
    .innerJoin(workOrders, eq(workOrders.id, inventoryReservation.workOrderId))
    .where(
      and(
        eq(inventoryReservation.partId, input.partId),
        eq(inventoryReservation.status, "active"),
        input.workOrderId ? ne(inventoryReservation.workOrderId, input.workOrderId) : sql`true`,
      ),
    );
  const targets = raided.map((r) => r.target).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const needBy = targets.length ? targets[0].toISOString().slice(0, 10) : null;

  const [log] = await db
    .insert(stockOverrideLog)
    .values({
      workOrderId: input.workOrderId ?? null,
      partId: input.partId,
      sku: p?.sku ?? null,
      qty: result.taken,
      reason: input.reason.trim(),
      userId: input.userId ?? null,
    })
    .returning({ id: stockOverrideLog.id });

  const [req] = await db
    .insert(backfillRequisition)
    .values({
      partId: input.partId,
      sku: p?.sku ?? null,
      qty: result.taken,
      triggeredBy: "reserved_override",
      sourceOverrideId: log.id,
      needBy,
    })
    .returning({ id: backfillRequisition.id });

  return { overrideId: log.id, requisitionId: req.id, issued: result.taken };
}

// ── Requisitions ────────────────────────────────────────────────────────────────

export async function listRequisitions(status?: "open" | "ordered" | "received") {
  return db
    .select({
      id: backfillRequisition.id,
      partId: backfillRequisition.partId,
      sku: backfillRequisition.sku,
      name: parts.name,
      qty: backfillRequisition.qty,
      triggeredBy: backfillRequisition.triggeredBy,
      needBy: backfillRequisition.needBy,
      status: backfillRequisition.status,
      purchaseOrderId: backfillRequisition.purchaseOrderId,
      poNumber: purchaseOrders.poNumber,
      createdAt: backfillRequisition.createdAt,
    })
    .from(backfillRequisition)
    .leftJoin(parts, eq(parts.id, backfillRequisition.partId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, backfillRequisition.purchaseOrderId))
    .where(status ? eq(backfillRequisition.status, status) : undefined)
    .orderBy(desc(backfillRequisition.createdAt));
}

/**
 * Turn an open requisition into an individual PO. The single line is stamped
 * source_kind = 'backfill' so its cost layer carries that provenance on receipt
 * (Phase 4 / Phase 7). Unit cost pre-fills from the à la carte price list for
 * the part's supplier vendor, falling back to parts.cost.
 */
export async function createPOFromRequisition(reqId: string): Promise<{ purchaseOrderId: string; poNumber: string }> {
  const [req] = await db.select().from(backfillRequisition).where(eq(backfillRequisition.id, reqId)).limit(1);
  if (!req) throw new Error("Requisition not found.");
  if (req.status !== "open") throw new Error("This requisition is not open.");
  if (!req.partId) throw new Error("This requisition has no part.");

  const [part] = await db
    .select({ id: parts.id, sku: parts.sku, name: parts.name, cost: parts.cost, vendorId: parts.vendorId })
    .from(parts)
    .where(eq(parts.id, req.partId))
    .limit(1);
  if (!part) throw new Error("Part not found.");

  let unitCost = part.cost != null ? Number(part.cost) : 0;
  if (part.vendorId) {
    const alacarte = await currentAlacarteCost(part.vendorId, part.sku);
    if (alacarte != null) unitCost = alacarte;
  }

  const poNumber = `PO-${Date.now().toString().slice(-7)}`;
  const line: POLineItem = {
    id: randomUUID(),
    partId: part.id,
    sku: part.sku,
    description: `${part.sku} — ${part.name}`,
    quantity: req.qty,
    quantityReceived: 0,
    unitCost,
    sourceKind: "backfill",
  };
  const total = (req.qty * unitCost).toFixed(2);

  return db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        poNumber,
        vendorId: part.vendorId ?? null,
        status: "pending",
        lineItems: [line] as never,
        total,
        notes: `Backfill for requisition ${reqId}${req.needBy ? ` — need by ${req.needBy}` : ""}.`,
      })
      .returning({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber });

    await tx
      .update(backfillRequisition)
      .set({ status: "ordered", purchaseOrderId: po.id, updatedAt: new Date() })
      .where(eq(backfillRequisition.id, reqId));

    return { purchaseOrderId: po.id, poNumber: po.poNumber ?? poNumber };
  });
}

export async function setRequisitionStatus(reqId: string, status: "open" | "ordered" | "received") {
  await db.update(backfillRequisition).set({ status, updatedAt: new Date() }).where(eq(backfillRequisition.id, reqId));
}
