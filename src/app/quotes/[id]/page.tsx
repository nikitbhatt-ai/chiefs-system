import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, customers } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { QuoteTabs } from "@/components/QuoteTabs";
import { QuoteEditor, type QuoteLine } from "./QuoteEditor";
import { QuoteWorkflowStrip } from "./QuoteWorkflowStrip";
import { upsertQuoteLink } from "@/lib/customerDocLinks";
import { quoteTotals } from "@/lib/quoteTotals";

export const dynamic = "force-dynamic";

async function saveQuote(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const customerId = String(formData.get("customerId") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const linesJson = String(formData.get("lines") ?? "[]");
  const lines = JSON.parse(linesJson) as QuoteLine[];

  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) return;

  // Only accept a recognized status. If the field is missing or garbage,
  // keep the quote's existing status rather than silently clobbering it back
  // to "draft" (the old `?? "draft"` default was the "reverts to draft" bug).
  const VALID_STATUSES = ["draft", "sent", "approved", "converted"] as const;
  const rawStatus = String(formData.get("status") ?? "");
  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as (typeof VALID_STATUSES)[number])
    : q.status;

  // NOTE: The restricted-part credential coverage gate that lived here was
  // removed in tandem with PR #23 (which dropped the canAdvanceTo hard
  // gate on the Walk-In Credentialed pipeline). Credential checks are no
  // longer enforced anywhere — they were blocking saves silently and
  // surfacing as a "status revert to draft" on the quote editor.

  const taxRate = Number(formData.get("taxRate") ?? "0") || 0;
  // Round each line before summing (shared helper) so the stored totals foot to
  // the per-line totals shown on the quote/PDF.
  const { subtotal, tax: taxTotal, grand: grandTotal } = quoteTotals(lines, taxRate);

  // Vehicle (from the in-editor VIN decoder). Blank fields clear.
  const vin = String(formData.get("vin") ?? "").trim().toUpperCase() || null;
  const vehicleYearRaw = String(formData.get("vehicleYear") ?? "").trim();
  const vehicleYear = vehicleYearRaw && !Number.isNaN(Number(vehicleYearRaw))
    ? Number(vehicleYearRaw)
    : null;
  const vehicleMake = String(formData.get("vehicleMake") ?? "").trim() || null;
  const vehicleModel = String(formData.get("vehicleModel") ?? "").trim() || null;
  const vehicleTrim = String(formData.get("vehicleTrim") ?? "").trim() || null;
  const unitNumber = String(formData.get("unitNumber") ?? "").trim() || null;

  await db
    .update(quotes)
    .set({
      customerId,
      status,
      notes,
      lineItems: lines as never,
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      vin,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      vehicleTrim,
      unitNumber,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, id));
  // Auto-link is best-effort: the quote already saved by the time we get
  // here, so an upstream failure in customer_documents must not bubble
  // up and make the save appear broken to the user.
  try {
    await upsertQuoteLink(id);
  } catch (err) {
    console.error("upsertQuoteLink failed:", err);
  }
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/workflow");
  if (customerId) revalidatePath(`/crm/${customerId}`);
}

// Ordered workflow stages, shared with the client strip below. The stage
// move itself (work-order upsert, approval gate, inventory deduction on the
// in_progress crossing, CRM sync) is owned by POST /api/quotes/[id]/workflow-stage
// so there is a single code path — the strip just calls that endpoint.
const WORKFLOW_STAGES = [
  "estimate",
  "confirmed",
  "awaiting_parts",
  "next_in_line",
  "in_progress",
  "qc_check",
  "completed",
  "delivered",
] as const;

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) notFound();

  const customerRows = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .orderBy(customers.name);

  const initial = (q.lineItems as unknown as QuoteLine[]) ?? [];

  return (
    <AppShell
      title={q.quoteNumber ?? "Quote"}
      subtitle={`Status: ${q.status} · Stage: ${q.workflowStage.replace(/_/g, " ")}`}
    >
      <QuoteTabs quoteId={q.id} active="quote" />

      <div className="flex justify-end gap-2">
        <a
          href={`/api/pdf/quotes/${q.id}`}
          target="_blank"
          rel="noopener"
          className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold"
        >
          Download PDF
        </a>
        {q.status === "converted" && (
          <a
            href={`/api/pdf/quotes/${q.id}?variant=invoice`}
            target="_blank"
            rel="noopener"
            className="text-[11px] font-body bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 rounded-md px-3 py-1.5"
          >
            Download invoice PDF
          </a>
        )}
        <a
          href={`/quotes/${q.id}/print`}
          target="_blank"
          rel="noopener"
          className="text-[11px] font-body bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 rounded-md px-3 py-1.5"
        >
          Open print view
        </a>
      </div>

      <QuoteWorkflowStrip
        quoteId={q.id}
        stages={WORKFLOW_STAGES}
        currentStage={q.workflowStage}
      />

      <QuoteEditor
        id={q.id}
        customerId={q.customerId}
        status={q.status}
        notes={q.notes ?? ""}
        initialLines={initial}
        customers={customerRows}
        initialVin={q.vin ?? ""}
        initialVehicleYear={q.vehicleYear != null ? String(q.vehicleYear) : ""}
        initialVehicleMake={q.vehicleMake ?? ""}
        initialVehicleModel={q.vehicleModel ?? ""}
        initialVehicleTrim={q.vehicleTrim ?? ""}
        initialUnitNumber={q.unitNumber ?? ""}
        action={saveQuote}
      />
    </AppShell>
  );
}
