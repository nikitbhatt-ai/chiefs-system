// Lead-time math for procurement planning.
//
// A work order has a target_build_start_date and a safety_buffer_days. The
// quote tied to that work order has line items that reference part_ids;
// each part has a lead_time_days. The latest a given part can be ordered
// without delaying the build is:
//   target_build_start_date - lead_time_days - safety_buffer_days
//
// "Parts to order now" surfaces every required part whose latest order
// date has slipped within an alert horizon. Critical-path surfaces the
// long-lead parts driving the build start (the longest lead time among
// not-yet-ordered parts is the floor on how soon we could start).
//
// "Already ordered" = a non-cancelled purchase_orders row has a line
// referencing this part_id, in a quantity >= what the quote needs. We
// don't reconcile partials yet — partial coverage still shows as
// at-risk so a buyer can decide whether to top up.

import type { POLineItem } from "@/db/schema";

export type QuoteLine = {
  kind?: string;
  partId?: string;
  description?: string;
  quantity?: number;
};

export type PartRef = {
  id: string;
  sku: string | null;
  name: string;
  leadTimeDays: number;
  vendorId: string | null;
  vendorName: string | null;
};

export type ProcurementStatus =
  | "ordered" // covered by an active PO
  | "overdue" // latest order date in the past, not ordered
  | "at_risk" // latest order date within alert horizon
  | "comfortable"; // latest order date far enough out

export type PartPlanRow = {
  partId: string;
  sku: string | null;
  name: string;
  quantity: number;
  vendorId: string | null;
  vendorName: string | null;
  leadTimeDays: number;
  latestOrderDate: Date | null;
  daysUntilLatestOrder: number | null;
  status: ProcurementStatus;
  orderedQuantity: number;
};

const DEFAULT_ALERT_DAYS = 14;

export function latestOrderDate(
  targetBuildStart: Date | null,
  leadTimeDays: number,
  bufferDays: number,
): Date | null {
  if (!targetBuildStart) return null;
  const ms = targetBuildStart.getTime() - (leadTimeDays + bufferDays) * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

// Roll up the quote line items into a quantity-per-part map. Free-form
// lines without a partId are ignored — they have no inventory link, so
// procurement can't plan for them.
export function requiredPartQuantities(lineItems: QuoteLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const li of lineItems) {
    if (li.kind && li.kind !== "item") continue;
    if (!li.partId) continue;
    const q = Number(li.quantity ?? 0);
    if (!Number.isFinite(q) || q <= 0) continue;
    m.set(li.partId, (m.get(li.partId) ?? 0) + q);
  }
  return m;
}

// For each part_id, sum the open-PO line-item quantities. Open = status
// pending or ordered (not received or cancelled). Caller passes the rows.
export function partOrderedQuantities(
  openPOLines: { partId?: string | null; quantity: number }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const li of openPOLines) {
    if (!li.partId) continue;
    m.set(li.partId, (m.get(li.partId) ?? 0) + (Number(li.quantity) || 0));
  }
  return m;
}

export function classify(
  latest: Date | null,
  required: number,
  ordered: number,
  now: Date = new Date(),
  alertDays: number = DEFAULT_ALERT_DAYS,
): ProcurementStatus {
  if (ordered >= required && required > 0) return "ordered";
  if (!latest) return required > 0 ? "at_risk" : "comfortable";
  const days = (latest.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (days < 0) return "overdue";
  if (days <= alertDays) return "at_risk";
  return "comfortable";
}

export function buildPartPlan(
  required: Map<string, number>,
  partsById: Map<string, PartRef>,
  openOrdered: Map<string, number>,
  targetBuildStart: Date | null,
  bufferDays: number,
  now: Date = new Date(),
): PartPlanRow[] {
  const rows: PartPlanRow[] = [];
  for (const [partId, qty] of required) {
    const p = partsById.get(partId);
    if (!p) continue;
    const lod = latestOrderDate(targetBuildStart, p.leadTimeDays, bufferDays);
    const ordered = openOrdered.get(partId) ?? 0;
    const days = lod ? (lod.getTime() - now.getTime()) / (24 * 60 * 60 * 1000) : null;
    rows.push({
      partId,
      sku: p.sku,
      name: p.name,
      quantity: qty,
      vendorId: p.vendorId,
      vendorName: p.vendorName,
      leadTimeDays: p.leadTimeDays,
      latestOrderDate: lod,
      daysUntilLatestOrder: days,
      status: classify(lod, qty, ordered, now),
      orderedQuantity: ordered,
    });
  }
  return rows;
}

// Sort: overdue first, then at-risk by days remaining ascending, then
// comfortable, then ordered. Within ties, longer lead time first
// (critical-path heuristic).
const STATUS_RANK: Record<ProcurementStatus, number> = {
  overdue: 0,
  at_risk: 1,
  comfortable: 2,
  ordered: 3,
};
export function sortPlan(rows: PartPlanRow[]): PartPlanRow[] {
  return [...rows].sort((a, b) => {
    const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (r !== 0) return r;
    if (a.daysUntilLatestOrder != null && b.daysUntilLatestOrder != null) {
      const d = a.daysUntilLatestOrder - b.daysUntilLatestOrder;
      if (d !== 0) return d;
    }
    return b.leadTimeDays - a.leadTimeDays;
  });
}

// Critical path: pretend nothing is ordered, find the longest lead-time
// part among required. That's the soonest the build could start from
// today + buffer.
export function criticalPathForPlan(rows: PartPlanRow[]): {
  longestLeadPartId: string | null;
  longestLeadDays: number;
  longestLeadName: string | null;
} {
  let longest = -1;
  let id: string | null = null;
  let name: string | null = null;
  for (const r of rows) {
    if (r.leadTimeDays > longest) {
      longest = r.leadTimeDays;
      id = r.partId;
      name = r.name;
    }
  }
  return { longestLeadPartId: id, longestLeadDays: Math.max(0, longest), longestLeadName: name };
}

// Vendor lead-time variance. For each received PO line, compare
// (received_at - po.created_at) against parts.lead_time_days. Negative
// variance means the vendor delivered faster than quoted; positive means
// slower. Caller passes joined rows.
export type VarianceSample = {
  vendorId: string | null;
  vendorName: string | null;
  partId: string;
  partName: string;
  quotedLeadDays: number;
  actualLeadDays: number;
  variance: number;
  receivedAt: Date;
};

export type VarianceRollup = {
  vendorId: string | null;
  vendorName: string | null;
  samples: number;
  avgQuoted: number;
  avgActual: number;
  avgVariance: number;
  worstVariance: number;
};

export function rollupVarianceByVendor(samples: VarianceSample[]): VarianceRollup[] {
  const m = new Map<string, VarianceRollup>();
  for (const s of samples) {
    const key = s.vendorId ?? "__unset__";
    let r = m.get(key);
    if (!r) {
      r = {
        vendorId: s.vendorId,
        vendorName: s.vendorName,
        samples: 0,
        avgQuoted: 0,
        avgActual: 0,
        avgVariance: 0,
        worstVariance: -Infinity,
      };
      m.set(key, r);
    }
    r.samples += 1;
    r.avgQuoted += s.quotedLeadDays;
    r.avgActual += s.actualLeadDays;
    r.avgVariance += s.variance;
    if (s.variance > r.worstVariance) r.worstVariance = s.variance;
  }
  for (const r of m.values()) {
    if (r.samples > 0) {
      r.avgQuoted /= r.samples;
      r.avgActual /= r.samples;
      r.avgVariance /= r.samples;
    }
    if (r.worstVariance === -Infinity) r.worstVariance = 0;
  }
  return Array.from(m.values()).sort((a, b) => b.avgVariance - a.avgVariance);
}

// Type bridge: POLineItem from schema may carry partId. Re-export helper to
// avoid sprinkling jsonb casts.
export function poLinesAsRefs(lines: POLineItem[]): { partId?: string | null; quantity: number }[] {
  return lines.map((l) => ({ partId: l.partId ?? null, quantity: Number(l.quantity) || 0 }));
}
