import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, customers, upfitConfigs } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { EmailCustomerButton } from "@/components/EmailCustomerButton";
import { FlushLink } from "@/components/FlushLink";
import { UpfitDiagramPreview } from "@/components/upfit/UpfitDiagramPreview";
import { getTemplate } from "@/lib/upfit/templates";
import { BRANDING } from "@/lib/pdf/branding";
import { QuoteEditor, type QuoteLine } from "./QuoteEditor";
import { QuoteWorkflowStrip } from "./QuoteWorkflowStrip";
import { upsertQuoteLink } from "@/lib/customerDocLinks";
import { quoteTotals, impliedTaxRatePct } from "@/lib/quoteTotals";
import { quoteDocumentFacts } from "@/lib/quoteDocumentFacts";

export const dynamic = "force-dynamic";

async function saveQuote(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const linesJson = String(formData.get("lines") ?? "[]");
  const lines = JSON.parse(linesJson) as QuoteLine[];

  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) return;

  // The editor only sends customerId / status when the rep changed them, so a
  // stale tab can't put back a value someone else has since changed. Absent →
  // keep what's stored.
  const customerId = formData.has("customerId")
    ? String(formData.get("customerId") ?? "") || null
    : q.customerId;

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
  const [config] = await db.select().from(upfitConfigs).where(eq(upfitConfigs.quoteId, q.id));
  const [customer] = q.customerId
    ? await db
        .select({ name: customers.name, email: customers.email })
        .from(customers)
        .where(eq(customers.id, q.customerId))
    : [];
  const configTemplate = config ? getTemplate(config.bodyStyle) : null;
  const lightCount = config?.pins?.length ?? 0;
  // Internal average cost per part, so the editor can show cost and margin per
  // line. Same resolver the documents use, so the numbers agree.
  const { partCosts } = await quoteDocumentFacts(q);

  return (
    <AppShell
      title={q.quoteNumber ?? "Quote"}
      subtitle={`Status: ${q.status} · Stage: ${q.workflowStage.replace(/_/g, " ")}`}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <EmailCustomerButton
          quoteId={q.id}
          quoteNumber={q.quoteNumber ?? "estimate"}
          customerName={customer?.name ?? null}
          defaultTo={customer?.email ?? ""}
          hasConfiguration={!!config}
          companyName={BRANDING.companyName}
        />
        {/* Two documents come off a quote and they must never be confused, so
            each button names its audience rather than saying "Download PDF":
            this one is the priced customer quote, the blue one below is the
            de-priced shop build sheet. */}
        <FlushLink
          newTab
          href={`/api/pdf/quotes/${q.id}`}
          title="The priced quote you send the customer: unit price, discounts, labor, fees and total."
          className="text-[11px] font-body bg-amber-500 hover:bg-amber-400 text-black rounded-md px-3 py-1.5 font-semibold"
        >
          Download customer PDF
        </FlushLink>
        {q.status === "converted" && (
          <FlushLink
            newTab
            href={`/api/pdf/quotes/${q.id}?variant=invoice`}
            className="text-[11px] font-body bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 rounded-md px-3 py-1.5"
          >
            Download invoice PDF
          </FlushLink>
        )}
        {/* The shop's build sheet: the same line items with every price
            stripped out. Keyed on the estimate so it's here rather than only on
            the work-order page, and so it works before a work order exists. */}
        <FlushLink
          newTab
          href={`/api/pdf/work-orders/by-quote/${q.id}`}
          title="Build sheet for the shop: part, brand, part # and qty, plus any line notes. No pricing of any kind."
          className="text-[11px] font-body bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-500/40 rounded-md px-3 py-1.5 font-semibold"
        >
          Download work order PDF
        </FlushLink>
        <FlushLink
          newTab
          href={`/quotes/${q.id}/print`}
          className="text-[11px] font-body bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 rounded-md px-3 py-1.5"
        >
          Open print view
        </FlushLink>
        {/* The internal copy carries our cost and margin on every line. Styled
            amber and labelled so it is never confused with the two customer
            documents sitting next to it. */}
        <FlushLink
          newTab
          href={`/api/pdf/quotes/${q.id}?internal=1${q.status === "converted" ? "&variant=invoice" : ""}`}
          title="Sales copy: shows our average cost and margin per line. Do not send to the customer."
          className="text-[11px] font-body bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-md px-3 py-1.5"
        >
          Internal copy (cost + margin)
        </FlushLink>
      </div>

      <QuoteWorkflowStrip
        quoteId={q.id}
        stages={WORKFLOW_STAGES}
        currentStage={q.workflowStage}
      />

      {/* Vehicle & Lights — the lighting layout for this estimate. Visual
          only: the parts are quoted as line items below. */}
      <section className="bg-surface border border-white/10 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-ui font-bold text-lg text-white">Vehicle &amp; Lights</h2>
          {config ? (
            <div className="flex flex-wrap gap-2">
              <FlushLink href={`/api/pdf/upfit/${q.id}`} className="btn-outline btn-sm">
                Spec sheet PDF
              </FlushLink>
              <FlushLink href={`/quotes/${q.id}/upfit`} className="btn-outline btn-sm">
                Edit Configuration
              </FlushLink>
            </div>
          ) : null}
        </div>
        {config && configTemplate ? (
          <div className="mt-4 space-y-3">
            <div className="font-ui font-bold text-base text-white">
              {config.vehicleLabel?.trim() || configTemplate.label}
              <span className="text-sm text-zinc-400 font-body font-normal">
                {" "}
                · {lightCount} {lightCount === 1 ? "light" : "lights"}
              </span>
            </div>
            <UpfitDiagramPreview bodyStyle={config.bodyStyle} pins={config.pins ?? []} />
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="font-ui font-bold text-xl text-white">No vehicle configured</div>
            <p className="text-sm text-zinc-400 mt-2 max-w-xl mx-auto">
              Add a vehicle to draw the lighting layout. The diagram is visual only — parts are quoted as
              line items separately.
            </p>
            <FlushLink href={`/quotes/${q.id}/upfit`} className="btn-cta mt-5">
              + Configure Vehicle
            </FlushLink>
          </div>
        )}
      </section>

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
        initialTaxRate={String(impliedTaxRatePct(initial, Number(q.taxTotal ?? 0)))}
        partCosts={partCosts}
        action={saveQuote}
      />
    </AppShell>
  );
}
