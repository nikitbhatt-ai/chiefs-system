import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { desc, inArray } from "drizzle-orm";
import { quotes, customers, upfitConfigs, workOrders, invoices, parts, vendors } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { EstimateSteps, type EstimateStep } from "@/components/EstimateSteps";
import { FlushLink } from "@/components/FlushLink";
import { UpfitDiagramPreview } from "@/components/upfit/UpfitDiagramPreview";
import { getTemplate } from "@/lib/upfit/templates";
import { normalizePins } from "@/lib/upfit/composites";
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

  // 0–100%. The tax_rate column is numeric(6,3), so round to 3 places.
  const taxRate = Math.round(Math.min(100, Math.max(0, Number(formData.get("taxRate") ?? "0") || 0)) * 1000) / 1000;
  // Estimate-level fields. Absent (older client) → keep what's stored.
  const has = (k: string) => formData.has(k);
  const str = (k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max) || null;
  const taxExempt = has("taxExempt") ? formData.get("taxExempt") === "1" : q.taxExempt;
  const hideLinePrices = has("hideLinePrices") ? formData.get("hideLinePrices") === "1" : q.hideLinePrices;
  const title = has("title") ? str("title", 200) : q.title;
  const customerPo = has("customerPo") ? str("customerPo", 100) : q.customerPo;
  const validRaw = has("validUntil") ? String(formData.get("validUntil") ?? "") : (q.validUntil ?? "");
  const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(validRaw) ? validRaw : null;
  // Round each line before summing (shared helper) so the stored totals foot to
  // the per-line totals shown on the quote/PDF. Exempt → no tax, but the rate
  // is kept so switching exemption off restores it.
  const { subtotal, tax: taxTotal, grand: grandTotal } = quoteTotals(lines, taxExempt ? 0 : taxRate);

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
      title,
      customerPo,
      validUntil,
      hideLinePrices,
      taxExempt,
      taxRate: String(taxRate),
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

// Status change from the estimate's "what's next" banner (Mark Accepted,
// Undo accept). Converted is set by invoicing, never from here.
async function setQuoteStatus(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("status") ?? "");
  if (!id || !["draft", "sent", "approved"].includes(next)) return;
  await db
    .update(quotes)
    .set({ status: next as "draft" | "sent" | "approved", updatedAt: new Date() })
    .where(eq(quotes.id, id));
  try {
    await upsertQuoteLink(id);
  } catch (err) {
    console.error("upsertQuoteLink failed:", err);
  }
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/workflow");
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

  const allCustomers = await db
    .select({
      id: customers.id,
      name: customers.name,
      address: customers.address,
      email: customers.email,
      phone: customers.phone,
      taxExempt: customers.taxExempt,
      archived: customers.archived,
    })
    .from(customers)
    .orderBy(customers.name);
  // Archived customers drop out of the picker, except the one already on it.
  const customerRows = allCustomers
    .filter((c) => !c.archived || c.id === q.customerId)
    .map(({ archived: _archived, ...c }) => c);
  const customer = allCustomers.find((c) => c.id === q.customerId) ?? null;

  const initial = (q.lineItems as unknown as QuoteLine[]) ?? [];
  const [config] = await db.select().from(upfitConfigs).where(eq(upfitConfigs.quoteId, q.id));
  const [wo] = await db
    .select({ id: workOrders.id, number: workOrders.woNumber, status: workOrders.status })
    .from(workOrders)
    .where(eq(workOrders.quoteId, q.id));
  const [inv] = await db
    .select({ id: invoices.id, number: invoices.documentNumber })
    .from(invoices)
    .where(eq(invoices.quoteId, q.id))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  const step: EstimateStep =
    inv || q.status === "converted"
      ? "invoice"
      : wo
        ? "work_order"
        : q.status === "approved"
          ? "sales_order"
          : "estimate";
  const configTemplate = config ? getTemplate(config.bodyStyle) : null;
  const lightCount = config?.pins?.length ?? 0;
  // Internal average cost per part, so the editor can show cost and margin per
  // line. Same resolver the documents use, so the numbers agree.
  const { partCosts } = await quoteDocumentFacts(q);
  // Manufacturer of each saved part line, so the editor can group lines by brand.
  const linePartIds = [
    ...new Set(initial.flatMap((l) => (l.kind === "item" && l.partId ? [l.partId] : []))),
  ];
  const mfrRows = linePartIds.length
    ? await db
        .select({ partId: parts.id, id: vendors.id, name: vendors.name })
        .from(parts)
        .leftJoin(vendors, eq(vendors.id, parts.manufacturerId))
        .where(inArray(parts.id, linePartIds))
    : [];
  const partManufacturers = Object.fromEntries(
    mfrRows.map((r) => [r.partId, { id: r.id ?? null, name: r.name ?? null }]),
  );
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const statusLabel: Record<string, string> = {
    draft: "Draft",
    sent: "Sent",
    approved: "Accepted",
    converted: "Invoiced",
  };

  const vehicleCard = (
    /* Vehicle & Lights — the lighting layout for this estimate. Visual
       only: the parts are quoted as line items below. */
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
          <UpfitDiagramPreview bodyStyle={config.bodyStyle} pins={normalizePins(config.bodyStyle, config.pins ?? [])} />
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
  );

  return (
    <AppShell title="Estimate" subtitle={q.quoteNumber ?? "Estimate"}>
      {/* Header: title + badges, then the two documents. */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-white/10">
        <div className="min-w-0">
          <div className="label-caps">
            <a href="/quotes" className="text-[var(--color-cta)] hover:underline">
              Estimates
            </a>{" "}
            / {q.quoteNumber ?? "Estimate"}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h1 className={`font-ui font-bold text-3xl ${q.title ? "text-white" : "text-zinc-400"}`}>
              {q.title || "Estimate — add a title"}
            </h1>
            <span className="label-caps !text-zinc-200 border border-white/20 rounded-full px-3 py-1">
              ● {statusLabel[q.status] ?? q.status}
            </span>
            {q.taxExempt ? (
              <span className="label-caps !text-[var(--color-cta)] border border-[color-mix(in_srgb,var(--color-cta)_50%,transparent)] rounded-full px-3 py-1">
                Tax exempt
              </span>
            ) : null}
          </div>
          <p className="text-sm text-zinc-400 mt-1.5">
            {[q.quoteNumber, customer?.name, `Created ${fmtDate(q.createdAt)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Two documents come off an estimate and they must never be
              confused, so each button names its audience: the priced customer
              copy, and the de-priced shop packing slip / build sheet. */}
          <FlushLink
            newTab
            href={`/api/pdf/quotes/${q.id}${q.status === "converted" ? "?variant=invoice" : ""}`}
            title="The priced estimate you send the customer."
            className="btn-outline"
          >
            View PDF
          </FlushLink>
          <FlushLink
            newTab
            href={`/api/pdf/work-orders/by-quote/${q.id}`}
            title="Build sheet for the shop: part, brand, part # and qty, plus any line notes. No pricing of any kind."
            className="btn-outline"
          >
            Packing slip
          </FlushLink>
          <details className="relative">
            <summary className="btn-outline list-none cursor-pointer">More ▾</summary>
            <div className="absolute right-0 z-30 mt-2 w-64 bg-surface border border-white/15 rounded-xl p-2 shadow-xl flex flex-col">
              <FlushLink newTab href={`/quotes/${q.id}/print`} className="px-3 py-2 rounded-lg text-sm text-zinc-200 hover:bg-white/5">
                Open print view
              </FlushLink>
              {/* Internal copy: our cost and margin on every line. */}
              <FlushLink
                newTab
                href={`/api/pdf/quotes/${q.id}?internal=1${q.status === "converted" ? "&variant=invoice" : ""}`}
                title="Sales copy: shows our average cost and margin per line. Do not send to the customer."
                className="px-3 py-2 rounded-lg text-sm text-amber-300 hover:bg-white/5"
              >
                Internal copy (cost + margin)
              </FlushLink>
            </div>
          </details>
        </div>
      </div>

      <EstimateSteps
        quoteId={q.id}
        quoteNumber={q.quoteNumber ?? "estimate"}
        status={q.status}
        step={step}
        workOrder={wo ? { id: wo.id, number: wo.number, status: wo.status } : null}
        invoice={inv ? { id: inv.id, number: inv.number } : null}
        email={{
          customerName: customer?.name ?? null,
          defaultTo: customer?.email ?? "",
          hasConfiguration: !!config,
          companyName: BRANDING.companyName,
        }}
        setStatusAction={setQuoteStatus}
      />

      {/* Shop progress (the Workflow board's stages) once the build exists. */}
      {wo ? (
        <div className="space-y-2">
          <div className="label-caps">Shop progress</div>
          <QuoteWorkflowStrip quoteId={q.id} stages={WORKFLOW_STAGES} currentStage={q.workflowStage} />
        </div>
      ) : null}

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
        initialTaxRate={
          q.taxRate != null
            ? String(Number(q.taxRate))
            : String(impliedTaxRatePct(initial, Number(q.taxTotal ?? 0)))
        }
        quoteNumber={q.quoteNumber ?? ""}
        createdAt={fmtDate(q.createdAt)}
        initialTitle={q.title ?? ""}
        initialCustomerPo={q.customerPo ?? ""}
        initialValidUntil={q.validUntil ?? ""}
        initialHideLinePrices={q.hideLinePrices}
        initialTaxExempt={q.taxExempt}
        vehicleSlot={vehicleCard}
        partManufacturers={partManufacturers}
        partCosts={partCosts}
        action={saveQuote}
      />
    </AppShell>
  );
}
