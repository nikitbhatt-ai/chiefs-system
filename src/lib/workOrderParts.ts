// Single source for a work order's de-priced parts list (part name, brand,
// manufacturer part number, quantity). Sourced from the linked estimate so it
// always matches, with fee lines dropped. Used by both the work-order PDF
// (src/lib/pdf/registry.tsx) and the work-order detail page so the two never
// drift apart.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { workOrders, quotes, parts, vendors } from "@/db/schema";
import { isUuid } from "@/lib/uuid";

export type WorkOrderPartLine = {
  name: string;
  brand: string | null;
  partNumber: string | null;
  quantity: number;
  /** Sales' shop note for this line. Build sheet only — never a customer doc. */
  notes: string | null;
};

/**
 * A note sales left on a labor or fee line. Those lines carry no parts, so they
 * never reach the parts table above — but their notes are still instructions for
 * the shop, so they're surfaced separately rather than silently dropped. Only
 * the label and the note travel: hours, rates and amounts stay off the de-priced
 * build sheet.
 */
export type WorkOrderNoteLine = { label: string; notes: string };

type QuoteLineItem = {
  kind?: string;
  partId?: string;
  description?: string;
  quantity?: number;
  notes?: string;
};

/** Notes left on non-part (labor / fee) lines, in line order. Pure — no I/O. */
export function otherLineNotes(lineItems: unknown): WorkOrderNoteLine[] {
  return ((lineItems as QuoteLineItem[] | null) ?? [])
    .filter((l) => l?.kind && l.kind !== "item" && String(l.notes ?? "").trim() !== "")
    .map((l) => ({
      label: String(l.description ?? "").trim() || (l.kind === "labor" ? "Labor" : "Fee"),
      notes: String(l.notes).trim(),
    }));
}

// Resolve from a quote's already-loaded line items (avoids a re-query when the
// caller already has them).
export async function resolvePartsFromLineItems(lineItems: unknown): Promise<WorkOrderPartLine[]> {
  const itemLines = ((lineItems as QuoteLineItem[] | null) ?? []).filter((l) => l?.kind === "item");
  if (itemLines.length === 0) return [];

  const partIds = Array.from(new Set(itemLines.map((l) => l.partId).filter(isUuid)));
  const partRows = partIds.length
    ? await db
        .select({
          id: parts.id,
          name: parts.name,
          sku: parts.sku,
          mfgPartNumber: parts.mfgPartNumber,
          manufacturerId: parts.manufacturerId,
        })
        .from(parts)
        .where(inArray(parts.id, partIds))
    : [];
  const partById = new Map(partRows.map((p) => [p.id, p]));

  const mfgIds = Array.from(new Set(partRows.map((p) => p.manufacturerId).filter((x): x is string => !!x)));
  const mfgRows = mfgIds.length
    ? await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, mfgIds))
    : [];
  const mfgById = new Map(mfgRows.map((v) => [v.id, v.name]));

  return itemLines.map((l) => {
    const p = l.partId ? partById.get(l.partId) : undefined;
    const brand = p?.manufacturerId ? mfgById.get(p.manufacturerId) ?? null : null;
    return {
      name: p?.name ?? l.description ?? "—",
      brand,
      partNumber: p ? p.mfgPartNumber || p.sku : null,
      quantity: Number(l.quantity || 0),
      notes: String(l.notes ?? "").trim() || null,
    };
  });
}

// Resolve straight from a work-order id (loads its linked estimate first).
export async function resolveWorkOrderParts(workOrderId: string): Promise<WorkOrderPartLine[]> {
  const [wo] = await db.select({ quoteId: workOrders.quoteId }).from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo?.quoteId) return [];
  const [q] = await db.select({ lineItems: quotes.lineItems }).from(quotes).where(eq(quotes.id, wo.quoteId));
  return resolvePartsFromLineItems(q?.lineItems);
}
