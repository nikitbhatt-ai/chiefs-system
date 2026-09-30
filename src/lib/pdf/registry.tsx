// Universal PDF export registry. Every record type that wants PDF
// generation registers here once: a data resolver that loads + shapes the
// record from the database, plus a renderer that returns a React-PDF
// Document component. New record types added later only need to register
// here to inherit the API endpoint, audit log, and Download buttons.
//
// Phase 1 surface: quote (with invoice variant) + purchase_order.

import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, customers, purchaseOrders, vendors, upfitConfigs, workOrders } from "@/db/schema";
import { QuoteDocument, type QuoteData, type QuoteLine } from "./templates/quote";
import {
  PurchaseOrderDocument,
  type PurchaseOrderData,
  type POLine,
  type POFeeLine,
} from "./templates/purchaseOrder";
import { UpfitDocument, type UpfitPdfData } from "./templates/upfit";
import { WorkOrderDocument, type WorkOrderData } from "./templates/workOrder";
import { resolvePartsFromLineItems, otherLineNotes } from "@/lib/workOrderParts";
import { resolveVehicleLabel } from "@/lib/upfit/vehicleLabel";
import { quoteDocumentFacts } from "@/lib/quoteDocumentFacts";

export type RecordType =
  | "quote"
  | "invoice"
  | "purchase_order"
  | "upfit"
  | "work_order"
  // Same build sheet as "work_order", keyed on the ESTIMATE, so sales can pull
  // it from the quote before a work order exists.
  | "work_order_from_quote";

export type ResolvedPdf = {
  buffer: Buffer;
  fileName: string;
  template: string;
};

async function resolveQuote(
  recordId: string,
  variant: "quote" | "invoice",
  internal = false,
): Promise<QuoteData | null> {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, recordId));
  if (!q) return null;
  // Customer contact, vehicle detail and the assigned sales person all come
  // from one shared resolver so the PDF and the print view cannot disagree.
  const facts = await quoteDocumentFacts(q);
  return {
    quoteId: q.id,
    quoteNumber: q.quoteNumber,
    createdAt: q.createdAt,
    ...facts,
    internal,
    lineItems: ((q.lineItems as unknown as QuoteLine[]) ?? []),
    taxTotal: Number(q.taxTotal ?? 0),
    grandTotal: Number(q.grandTotal ?? 0),
    notes: q.notes ?? null,
    status: q.status,
    variant,
  };
}

async function resolvePurchaseOrder(recordId: string): Promise<PurchaseOrderData | null> {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, recordId));
  if (!po) return null;
  const vendor = po.vendorId
    ? (await db.select().from(vendors).where(eq(vendors.id, po.vendorId)))[0] ?? null
    : null;
  return {
    id: po.id,
    poNumber: po.poNumber,
    vendorName: vendor?.name ?? null,
    vendorAddress: vendor?.address ?? null,
    vendorEmail: vendor?.email ?? null,
    vendorPhone: vendor?.phone ?? null,
    status: po.status,
    total: Number(po.total ?? 0),
    expectedAt: po.expectedAt,
    receivedAt: po.receivedAt,
    createdAt: po.createdAt,
    notes: po.notes ?? null,
    lineItems: ((po.lineItems as unknown as POLine[]) ?? []),
    fees: ((po.fees as unknown as POFeeLine[]) ?? []),
  };
}

async function resolveUpfit(quoteId: string): Promise<UpfitPdfData | null> {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return null;
  const [config] = await db
    .select()
    .from(upfitConfigs)
    .where(eq(upfitConfigs.quoteId, quoteId));

  const customer = q.customerId
    ? (await db.select().from(customers).where(eq(customers.id, q.customerId)))[0] ?? null
    : null;

  // Stored override on the config wins; otherwise derive from the deal.
  const vehicleSummary = config?.vehicleLabel?.trim() || (await resolveVehicleLabel(q));

  return {
    quoteId: q.id,
    quoteNumber: q.quoteNumber,
    createdAt: q.createdAt,
    customerName: customer?.name ?? null,
    vehicleSummary: vehicleSummary || null,
    bodyStyle: config?.bodyStyle ?? "tahoe",
    pins: config?.pins ?? [],
    notes: config?.notes ?? null,
    // Page 2 of the spec sheet is the actual quote for this build.
    quoteLineItems: (q.lineItems as unknown as QuoteLine[]) ?? [],
    quoteTaxTotal: Number(q.taxTotal ?? 0),
    quoteGrandTotal: Number(q.grandTotal ?? 0),
    quoteStatus: q.status,
  };
}

// Work-order build sheet. Sourced from the linked estimate's line items so it
// always matches the estimate/invoice exactly, then stripped of all pricing:
// only part name, brand (manufacturer), manufacturer part number, and quantity.
// Fee lines are dropped entirely (they're pricing artifacts).
async function resolveWorkOrder(workOrderId: string): Promise<WorkOrderData | null> {
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo) return null;

  const customer = wo.customerId
    ? (await db.select().from(customers).where(eq(customers.id, wo.customerId)))[0] ?? null
    : null;

  let lineItems: WorkOrderData["lineItems"] = [];
  let lineNotes: WorkOrderData["lineNotes"] = [];
  let quoteNumber: string | null = null;
  let quoteForVehicle: typeof quotes.$inferSelect | null = null;
  if (wo.quoteId) {
    const [q] = await db.select().from(quotes).where(eq(quotes.id, wo.quoteId));
    if (q) {
      lineItems = await resolvePartsFromLineItems(q.lineItems);
      lineNotes = otherLineNotes(q.lineItems);
      quoteNumber = q.quoteNumber;
      quoteForVehicle = q;
    }
  }

  const vehicleSummary = quoteForVehicle ? await resolveVehicleLabel(quoteForVehicle) : null;

  return {
    workOrderId: wo.id,
    woNumber: wo.woNumber,
    quoteNumber,
    createdAt: wo.createdAt,
    status: wo.status,
    customerName: customer?.name ?? null,
    customerAddress: customer?.address ?? null,
    vehicleSummary: vehicleSummary || null,
    lineItems,
    lineNotes,
    notes: wo.notes ?? null,
  };
}

/**
 * The same build sheet, resolved straight from an ESTIMATE rather than a work
 * order, so sales can pull it from the quote before a work order exists (one is
 * only created when the deal reaches Won / confirmed). When the quote already
 * has a work order we borrow its number and status so the two documents match;
 * otherwise the sheet stands on the estimate alone.
 */
async function resolveWorkOrderFromQuote(quoteId: string): Promise<WorkOrderData | null> {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return null;

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.quoteId, q.id));

  const customerId = wo?.customerId ?? q.customerId ?? null;
  const customer = customerId
    ? (await db.select().from(customers).where(eq(customers.id, customerId)))[0] ?? null
    : null;

  return {
    workOrderId: wo?.id ?? q.id,
    woNumber: wo?.woNumber ?? null,
    quoteNumber: q.quoteNumber,
    createdAt: wo?.createdAt ?? q.createdAt,
    // No work order yet: report the estimate's own workflow stage so the sheet
    // never claims a shop status the job hasn't reached.
    status: wo?.status ?? q.workflowStage,
    customerName: customer?.name ?? null,
    customerAddress: customer?.address ?? null,
    vehicleSummary: (await resolveVehicleLabel(q)) || null,
    lineItems: await resolvePartsFromLineItems(q.lineItems),
    lineNotes: otherLineNotes(q.lineItems),
    notes: wo?.notes ?? null,
  };
}

// Render entry point. Looks up the record, picks the right template, and
// streams a Buffer back. Returns null if the record doesn't exist (the
// API layer turns that into a 404).
export async function renderRecordPdf(
  recordType: RecordType,
  recordId: string,
  /**
   * `internal: true` renders the sales team's copy — per-line cost and margin,
   * banner, `_INTERNAL` filename. Callers must only set it for a signed-in
   * user; it must never be reachable on a customer-facing path.
   */
  opts?: { internal?: boolean },
): Promise<ResolvedPdf | null> {
  if (recordType === "quote" || recordType === "invoice") {
    const variant = recordType === "invoice" ? "invoice" : "quote";
    const data = await resolveQuote(recordId, variant, opts?.internal === true);
    if (!data) return null;
    const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
    const dateStr = new Date(data.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
    // The filename says INTERNAL too, because that is what someone sees in
    // their downloads folder when they go to attach it to an email.
    const suffix = data.internal ? "_INTERNAL" : "";
    const fileName = `${variant === "invoice" ? "Invoice" : "Quote"}_${docNumber}_${dateStr}${suffix}.pdf`;
    const buffer = await renderToBuffer(<QuoteDocument data={data} />);
    const template = `${variant === "invoice" ? "invoice" : "quote"}${data.internal ? "_internal" : "_default"}`;
    return { buffer, fileName, template };
  }
  if (recordType === "upfit") {
    const data = await resolveUpfit(recordId);
    if (!data) return null;
    const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
    const dateStr = new Date(data.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `Upfit_${docNumber}_${dateStr}.pdf`;
    const buffer = await renderToBuffer(<UpfitDocument data={data} />);
    return { buffer, fileName, template: "upfit_default" };
  }
  if (recordType === "purchase_order") {
    const data = await resolvePurchaseOrder(recordId);
    if (!data) return null;
    const docNumber = data.poNumber ?? `PO-${data.id.slice(0, 8)}`;
    const dateStr = new Date(data.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `PO_${docNumber}_${dateStr}.pdf`;
    const buffer = await renderToBuffer(<PurchaseOrderDocument data={data} />);
    return { buffer, fileName, template: "purchase_order_default" };
  }
  if (recordType === "work_order" || recordType === "work_order_from_quote") {
    const data =
      recordType === "work_order"
        ? await resolveWorkOrder(recordId)
        : await resolveWorkOrderFromQuote(recordId);
    if (!data) return null;
    // Falls back to the estimate number when the job has no work order yet, so
    // the filename still names the job rather than a bare uuid fragment.
    const docNumber = data.woNumber ?? data.quoteNumber ?? `WO-${data.workOrderId.slice(0, 8)}`;
    const dateStr = new Date(data.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `WorkOrder_${docNumber}_${dateStr}.pdf`;
    const buffer = await renderToBuffer(<WorkOrderDocument data={data} />);
    return { buffer, fileName, template: "work_order_default" };
  }
  return null;
}
