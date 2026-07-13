// Invoice + payment helpers. An invoice is the customer + accounting
// document that closes out a work order. It shares the WO's
// `document_number` (6-digit) so the shop's build sheet and the
// customer's bill carry one shared identifier — ShopMonkey convention.

import { and, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { invoices, invoicePayments, workOrders, quotes } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/documentNumber";

export type CreateInvoiceResult =
  | { ok: true; invoiceId: string; documentNumber: number }
  | { ok: false; reason: "wo_not_found" | "no_quote" | "already_invoiced" };

// Create an invoice from a work order. Idempotent per WO: if the WO
// already has an invoice, returns { ok: false, already_invoiced }.
// Snapshots the source quote's lineItems + totals into the invoice.
// Reuses the WO's document_number (assigning one if the WO was created
// before the number column existed).
export async function createInvoiceFromWorkOrder(
  workOrderId: string,
): Promise<CreateInvoiceResult> {
  return await db.transaction(async (tx) => {
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId)).for("update");
    if (!wo) return { ok: false, reason: "wo_not_found" };

    const [existing] = await tx.select({ id: invoices.id, documentNumber: invoices.documentNumber })
      .from(invoices)
      .where(eq(invoices.workOrderId, workOrderId));
    if (existing) {
      return { ok: false, reason: "already_invoiced" };
    }

    if (!wo.quoteId) return { ok: false, reason: "no_quote" };
    const [q] = await tx.select().from(quotes).where(eq(quotes.id, wo.quoteId));
    if (!q) return { ok: false, reason: "no_quote" };

    // Reuse the WO's document number, or assign one now if the WO
    // predates the column (legacy rows). Either way, both the WO and
    // the new invoice carry the same identifier from here forward.
    let documentNumber = wo.documentNumber;
    if (documentNumber == null) {
      documentNumber = await nextDocumentNumber();
      await tx.update(workOrders).set({ documentNumber, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
    }

    const subtotal = Number(q.subtotal ?? 0) || 0;
    const taxTotal = Number(q.taxTotal ?? 0) || 0;
    const grandTotal = Number(q.grandTotal ?? 0) || 0;
    // Discount total isn't stored on the quote today; the invoice PDF
    // recomputes per-line discount from the line items, so we can leave
    // the aggregate at 0 for now and derive if needed later.
    const discountTotal = 0;

    // Default due date: 30 days from today. Editable later on the
    // invoice detail page.
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [inv] = await tx
      .insert(invoices)
      .values({
        documentNumber,
        workOrderId: wo.id,
        quoteId: q.id,
        customerId: wo.customerId ?? q.customerId ?? null,
        dealId: wo.dealId ?? q.dealId ?? null,
        status: "draft",
        subtotal: String(subtotal.toFixed(2)),
        discountTotal: String(discountTotal.toFixed(2)),
        taxTotal: String(taxTotal.toFixed(2)),
        grandTotal: String(grandTotal.toFixed(2)),
        amountPaid: "0",
        balanceDue: String(grandTotal.toFixed(2)),
        dueDate,
        lineItems: (q.lineItems ?? []) as never,
        notes: null,
      })
      .returning({ id: invoices.id, documentNumber: invoices.documentNumber });

    return { ok: true, invoiceId: inv.id, documentNumber: inv.documentNumber };
  });
}

export type RecordPaymentInput = {
  invoiceId: string;
  amount: number;
  method: "cash" | "check" | "card" | "ach" | "other";
  reference?: string | null;
  receivedBy?: string | null;
  notes?: string | null;
};

// Insert one payment row and re-derive the invoice's amount_paid /
// balance_due / status atomically. Status transitions:
//   amount_paid == 0  → status stays as-is (typically 'draft' or 'sent')
//   0 < paid < total  → 'partial'
//   paid >= total     → 'paid' and paid_at is stamped
export async function recordInvoicePayment(input: RecordPaymentInput) {
  if (!(input.amount > 0)) throw new Error("payment amount must be > 0");
  return await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).for("update");
    if (!inv) throw new Error("invoice not found");

    await tx.insert(invoicePayments).values({
      invoiceId: inv.id,
      amount: String(input.amount.toFixed(2)),
      method: input.method,
      reference: input.reference ?? null,
      receivedBy: input.receivedBy ?? null,
      notes: input.notes ?? null,
    });

    const [sums] = await tx
      .select({ total: sum(invoicePayments.amount) })
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, inv.id));
    const paid = Number(sums?.total ?? 0) || 0;
    const grand = Number(inv.grandTotal ?? 0) || 0;
    const balance = Math.max(0, grand - paid);

    let status = inv.status;
    let paidAt: Date | null = inv.paidAt ?? null;
    if (paid >= grand && grand > 0) {
      status = "paid";
      if (!paidAt) paidAt = new Date();
    } else if (paid > 0) {
      status = "partial";
    }

    await tx
      .update(invoices)
      .set({
        amountPaid: String(paid.toFixed(2)),
        balanceDue: String(balance.toFixed(2)),
        status,
        paidAt,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));

    return { amountPaid: paid, balanceDue: balance, status };
  });
}

// Fetch invoice + payment list for detail view.
export async function loadInvoiceWithPayments(invoiceId: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return null;
  const payments = await db
    .select()
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId))
    .orderBy(invoicePayments.receivedAt);
  return { invoice: inv, payments };
}

// Guard for the "already invoiced" case in UI (show 'View invoice' vs
// 'Generate invoice' button on the WO).
export async function findInvoiceByWorkOrder(workOrderId: string) {
  const [inv] = await db
    .select({ id: invoices.id, documentNumber: invoices.documentNumber, status: invoices.status })
    .from(invoices)
    .where(eq(invoices.workOrderId, workOrderId));
  return inv ?? null;
}

// silence unused import
void and;
