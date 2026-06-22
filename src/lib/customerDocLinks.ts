// Auto-link system for system-generated documents. Each linkable entity
// (quote, spec, etc.) gets a stable kind slug so we can upsert one
// customer_documents row per entity instead of churning duplicates as the
// entity is edited.
//
// These "virtual" docs point at the live print URL — clicking opens the
// current rendered view rather than a static blob. When PR for
// server-side PDF generation lands, the same row's `blob_url` can be
// swapped to the rendered PDF and the kind slug doesn't change.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerDocuments, quotes, workOrders } from "@/db/schema";
import type { CustomerDocCategory } from "@/lib/customerDocuments";

function quoteKind(quoteId: string) {
  return `auto_link:quote:${quoteId}`;
}

export async function upsertQuoteLink(quoteId: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return;
  const kind = quoteKind(quoteId);

  if (!q.customerId) {
    // No customer — purge any existing link.
    await db.delete(customerDocuments).where(eq(customerDocuments.kind, kind));
    return;
  }

  const category: CustomerDocCategory =
    q.status === "converted" ? "invoices" : "quotes_estimates";
  const baseName = q.quoteNumber ?? `Quote ${q.id.slice(0, 8)}`;
  const fileName = q.status === "converted" ? `${baseName} (invoice)` : baseName;
  const blobUrl = `/quotes/${q.id}/print`;
  const associatedDealId = q.dealId ?? null;

  const [existing] = await db
    .select({ id: customerDocuments.id })
    .from(customerDocuments)
    .where(and(eq(customerDocuments.kind, kind), eq(customerDocuments.isCurrentVersion, true)))
    .limit(1);

  if (existing) {
    await db
      .update(customerDocuments)
      .set({
        customerId: q.customerId,
        category,
        fileName,
        blobUrl,
        associatedDealId,
      })
      .where(eq(customerDocuments.id, existing.id));
  } else {
    await db.insert(customerDocuments).values({
      customerId: q.customerId,
      category,
      fileName,
      blobUrl,
      mimeType: "text/html",
      associatedDealId,
      kind,
      notes: "Auto-linked from the quote. Opens the live print view.",
    });
  }
}

export async function unlinkQuote(quoteId: string) {
  await db
    .delete(customerDocuments)
    .where(eq(customerDocuments.kind, quoteKind(quoteId)));
}

// Upfit-builder spec sheet auto-link. Lands in the customer folder
// under "Photos / Build Documentation" so the shop has the placement
// diagram alongside the rest of the build artifacts. Points to the live
// PDF endpoint — every click renders the current state, so edits to
// the upfit are immediately reflected without versioning churn.
function upfitKind(quoteId: string) {
  return `auto_link:upfit:${quoteId}`;
}

export async function upsertUpfitLink(quoteId: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) return;
  const kind = upfitKind(quoteId);

  if (!q.customerId) {
    await db.delete(customerDocuments).where(eq(customerDocuments.kind, kind));
    return;
  }

  const baseName = q.quoteNumber ?? `Quote ${q.id.slice(0, 8)}`;
  const fileName = `${baseName} (upfit spec)`;
  const blobUrl = `/api/pdf/upfit/${q.id}`;
  const associatedDealId = q.dealId ?? null;

  const [existing] = await db
    .select({ id: customerDocuments.id })
    .from(customerDocuments)
    .where(and(eq(customerDocuments.kind, kind), eq(customerDocuments.isCurrentVersion, true)))
    .limit(1);

  if (existing) {
    await db
      .update(customerDocuments)
      .set({
        customerId: q.customerId,
        category: "photos_build" as CustomerDocCategory,
        fileName,
        blobUrl,
        associatedDealId,
      })
      .where(eq(customerDocuments.id, existing.id));
  } else {
    await db.insert(customerDocuments).values({
      customerId: q.customerId,
      category: "photos_build" as CustomerDocCategory,
      fileName,
      blobUrl,
      mimeType: "application/pdf",
      associatedDealId,
      kind,
      notes: "Auto-linked upfit spec sheet. Opens the live PDF.",
    });
  }
}

export async function unlinkUpfit(quoteId: string) {
  await db
    .delete(customerDocuments)
    .where(eq(customerDocuments.kind, upfitKind(quoteId)));
}

// Work-order build sheet auto-link. Created when an estimate converts into a
// work order. Lands in the customer folder under "Spec / Build Approvals" so
// the shop floor has the de-priced pull sheet alongside the rest of the build
// paperwork. Points at the live PDF endpoint, which renders the work order
// with all pricing stripped (part name, brand, part number, quantity only).
function workOrderKind(workOrderId: string) {
  return `auto_link:work_order:${workOrderId}`;
}

export async function upsertWorkOrderLink(workOrderId: string) {
  const [wo] = await db
    .select({ id: workOrders.id, customerId: workOrders.customerId, woNumber: workOrders.woNumber, dealId: workOrders.dealId })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId));
  if (!wo) return;
  const kind = workOrderKind(workOrderId);

  if (!wo.customerId) {
    await db.delete(customerDocuments).where(eq(customerDocuments.kind, kind));
    return;
  }

  const baseName = wo.woNumber ?? `Work Order ${wo.id.slice(0, 8)}`;
  const fileName = `${baseName} (build sheet)`;
  const blobUrl = `/api/pdf/work-orders/${wo.id}`;
  const associatedDealId = wo.dealId ?? null;

  const [existing] = await db
    .select({ id: customerDocuments.id })
    .from(customerDocuments)
    .where(and(eq(customerDocuments.kind, kind), eq(customerDocuments.isCurrentVersion, true)))
    .limit(1);

  if (existing) {
    await db
      .update(customerDocuments)
      .set({
        customerId: wo.customerId,
        category: "spec_approvals" as CustomerDocCategory,
        fileName,
        blobUrl,
        associatedDealId,
      })
      .where(eq(customerDocuments.id, existing.id));
  } else {
    await db.insert(customerDocuments).values({
      customerId: wo.customerId,
      category: "spec_approvals" as CustomerDocCategory,
      fileName,
      blobUrl,
      mimeType: "application/pdf",
      associatedDealId,
      kind,
      notes: "Auto-linked work-order build sheet (no pricing). Opens the live PDF.",
    });
  }
}

export async function unlinkWorkOrder(workOrderId: string) {
  await db
    .delete(customerDocuments)
    .where(eq(customerDocuments.kind, workOrderKind(workOrderId)));
}
