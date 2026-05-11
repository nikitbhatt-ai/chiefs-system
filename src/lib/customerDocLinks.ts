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
import { customerDocuments, quotes } from "@/db/schema";
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
