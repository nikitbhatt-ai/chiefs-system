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
import { quotes, customers, purchaseOrders, vendors } from "@/db/schema";
import { QuoteDocument, type QuoteData, type QuoteLine } from "./templates/quote";
import { PurchaseOrderDocument, type PurchaseOrderData, type POLine } from "./templates/purchaseOrder";

export type RecordType = "quote" | "invoice" | "purchase_order";

export type ResolvedPdf = {
  buffer: Buffer;
  fileName: string;
  template: string;
};

async function resolveQuote(recordId: string, variant: "quote" | "invoice"): Promise<QuoteData | null> {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, recordId));
  if (!q) return null;
  const customer = q.customerId
    ? (await db.select().from(customers).where(eq(customers.id, q.customerId)))[0] ?? null
    : null;
  return {
    quoteId: q.id,
    quoteNumber: q.quoteNumber,
    createdAt: q.createdAt,
    customerName: customer?.name ?? null,
    customerEmail: customer?.email ?? null,
    customerAddress: customer?.address ?? null,
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
  };
}

// Render entry point. Looks up the record, picks the right template, and
// streams a Buffer back. Returns null if the record doesn't exist (the
// API layer turns that into a 404).
export async function renderRecordPdf(
  recordType: RecordType,
  recordId: string,
): Promise<ResolvedPdf | null> {
  if (recordType === "quote" || recordType === "invoice") {
    const variant = recordType === "invoice" ? "invoice" : "quote";
    const data = await resolveQuote(recordId, variant);
    if (!data) return null;
    const docNumber = data.quoteNumber ?? `Q-${data.quoteId.slice(0, 8)}`;
    const dateStr = new Date(data.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `${variant === "invoice" ? "Invoice" : "Quote"}_${docNumber}_${dateStr}.pdf`;
    const buffer = await renderToBuffer(<QuoteDocument data={data} />);
    return { buffer, fileName, template: variant === "invoice" ? "invoice_default" : "quote_default" };
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
  return null;
}
