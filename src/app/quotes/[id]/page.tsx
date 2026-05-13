import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, asc, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { quotes, customers, parts, workOrders, partReceipts, deals, dealCredentials } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { QuoteEditor, type QuoteLine } from "./QuoteEditor";
import { credentialCoversPart } from "@/lib/credentials";
import { upsertQuoteLink } from "@/lib/customerDocLinks";

export const dynamic = "force-dynamic";

async function saveQuote(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const customerId = String(formData.get("customerId") ?? "") || null;
  const status = String(formData.get("status") ?? "draft") as
    | "draft"
    | "sent"
    | "approved"
    | "converted";
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const linesJson = String(formData.get("lines") ?? "[]");
  const lines = JSON.parse(linesJson) as QuoteLine[];

  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) return;

  // NOTE: The restricted-part credential coverage gate that lived here was
  // removed in tandem with PR #23 (which dropped the canAdvanceTo hard
  // gate on the Walk-In Credentialed pipeline). Credential checks are no
  // longer enforced anywhere — they were blocking saves silently and
  // surfacing as a "status revert to draft" on the quote editor.

  let subtotal = 0;
  let discountTotal = 0;
  let feeTotal = 0;
  for (const l of lines) {
    if (l.kind === "item") {
      const gross = (l.quantity || 0) * (l.unitPrice || 0);
      const disc =
        l.discountKind === "pct"
          ? gross * ((l.discount || 0) / 100)
          : l.discount || 0;
      subtotal += gross;
      discountTotal += disc;
    } else if (l.kind === "fee") {
      feeTotal += l.amount || 0;
    }
  }
  const taxRate = Number(formData.get("taxRate") ?? "0") || 0;
  const taxableBase = subtotal - discountTotal + feeTotal;
  const taxTotal = taxableBase * (taxRate / 100);
  const grandTotal = taxableBase + taxTotal;

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

async function moveStage(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!id || !WORKFLOW_STAGES.includes(stage as (typeof WORKFLOW_STAGES)[number])) return;

  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) return;

  let [wo] = await db.select().from(workOrders).where(eq(workOrders.quoteId, id));
  if (!wo && stage !== "estimate") {
    const woNumber = `WO-${Date.now().toString().slice(-7)}`;
    const inserted = await db
      .insert(workOrders)
      .values({
        woNumber,
        customerId: q.customerId ?? null,
        quoteId: id,
        status: stage,
      })
      .returning();
    wo = inserted[0];
  } else if (wo) {
    await db
      .update(workOrders)
      .set({ status: stage, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
  }

  if (stage === "in_progress" && wo && !wo.partsConsumed) {
    const lines = (q.lineItems as unknown as QuoteLine[]) ?? [];
    for (const line of lines) {
      if (line.kind !== "item" || !line.partId) continue;
      const qty = Number(line.quantity || 0);
      if (qty <= 0) continue;
      const layers = await db
        .select()
        .from(partReceipts)
        .where(eq(partReceipts.partId, line.partId))
        .orderBy(asc(partReceipts.receivedAt));
      let need = qty;
      for (const layer of layers) {
        if (need <= 0) break;
        if (layer.quantityRemaining <= 0) continue;
        const take = Math.min(need, layer.quantityRemaining);
        await db
          .update(partReceipts)
          .set({ quantityRemaining: layer.quantityRemaining - take })
          .where(eq(partReceipts.id, layer.id));
        need -= take;
      }
      await db
        .update(parts)
        .set({
          quantityOnHand: sql`${parts.quantityOnHand} - ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(parts.id, line.partId));
    }
    await db
      .update(workOrders)
      .set({ partsConsumed: true, updatedAt: new Date() })
      .where(eq(workOrders.id, wo.id));
  }

  await db
    .update(quotes)
    .set({ workflowStage: stage, updatedAt: new Date() })
    .where(eq(quotes.id, id));

  revalidatePath("/workflow");
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/inventory");
  revalidatePath("/work-orders");
}

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

  const partRows = await db
    .select({
      id: parts.id,
      sku: parts.sku,
      name: parts.name,
      price: parts.price,
      cost: parts.cost,
      restricted: parts.restricted,
      restrictionCategory: parts.restrictionCategory,
    })
    .from(parts)
    .where(eq(parts.archived, false))
    .orderBy(parts.sku);

  const initial = (q.lineItems as unknown as QuoteLine[]) ?? [];

  return (
    <AppShell
      title={q.quoteNumber ?? "Quote"}
      subtitle={`Status: ${q.status} · Stage: ${q.workflowStage.replace(/_/g, " ")}`}
    >
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

      <div className="bg-[#161624] border border-white/5 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-body mb-2">
          Workflow stage
        </div>
        <div className="flex flex-wrap gap-2">
          {WORKFLOW_STAGES.map((s, i) => {
            const active = q.workflowStage === s;
            return (
              <form key={s} action={moveStage}>
                <input type="hidden" name="id" value={q.id} />
                <input type="hidden" name="stage" value={s} />
                <button
                  type="submit"
                  className={`text-[11px] font-body px-3 py-1.5 rounded border transition-colors ${
                    active
                      ? "bg-amber-500 text-black border-amber-400 font-semibold"
                      : "bg-black/40 text-zinc-300 border-white/10 hover:border-amber-500/50 hover:text-white"
                  }`}
                >
                  {i + 1}. {s.replace(/_/g, " ")}
                </button>
              </form>
            );
          })}
        </div>
      </div>

      <QuoteEditor
        id={q.id}
        customerId={q.customerId}
        status={q.status}
        notes={q.notes ?? ""}
        initialLines={initial}
        customers={customerRows}
        parts={partRows}
        action={saveQuote}
      />
    </AppShell>
  );
}
