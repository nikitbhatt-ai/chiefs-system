// Cross-system triggers fired off the back of deal stage changes.
//
// Today: when a deal advances into the Won bucket (po_received for
// Government, deposit_received for Walk-In Credentialed and Commercial),
// promote the deal's most recent quote from estimate to confirmed and
// auto-create a work order if none exists yet. One-way trigger: moving
// the deal back out of Won does NOT reverse the workflow.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { deals, quotes, workOrders, dealTasks, customerDocuments, dealActivity } from "@/db/schema";
import { bucketForStage } from "@/lib/pipelineBuckets";
import { docForPipeline } from "@/lib/documentTemplates";
import { getPipeline } from "@/lib/pipelines";

// Linear ordering of the quote workflow stages — same constant used in
// /quotes/[id]/page.tsx. Keep these in sync.
const WORKFLOW_ORDER = [
  "estimate",
  "confirmed",
  "awaiting_parts",
  "next_in_line",
  "in_progress",
  "qc_check",
  "completed",
  "delivered",
] as const;

export type WonPromotionResult =
  | { ok: true; promotedQuoteId: string; createdWorkOrderId: string | null }
  | { ok: false; reason: "not_won_bucket" | "no_quote" | "already_past_confirmed" };

export async function maybePromoteWonDeal(
  dealId: string,
  newStage: string,
  prevStage: string,
): Promise<WonPromotionResult> {
  if (bucketForStage(newStage) !== "won") return { ok: false, reason: "not_won_bucket" };
  // Only fire on the forward edge — if the previous stage was already in
  // Won (e.g. po_received → deposit_received reorder), don't re-trigger.
  if (bucketForStage(prevStage) === "won") return { ok: false, reason: "not_won_bucket" };

  // 1) Direct deal linkage. If no quote has quote.dealId = this deal, fall
  // back to the most recent non-converted quote belonging to the same
  // customer. Whichever we pick, stamp deal_id on it so future triggers and
  // the customer folder auto-link stay tight.
  const direct = await db
    .select()
    .from(quotes)
    .where(eq(quotes.dealId, dealId))
    .orderBy(desc(quotes.updatedAt))
    .limit(1);
  let q: (typeof direct)[number] | undefined = direct[0];

  if (!q) {
    const [deal] = await db.select({ customerId: deals.customerId }).from(deals).where(eq(deals.id, dealId));
    if (deal?.customerId) {
      const candidates = await db
        .select()
        .from(quotes)
        .where(eq(quotes.customerId, deal.customerId))
        .orderBy(desc(quotes.updatedAt));
      q = candidates.find((c) => c.status !== "converted");
      if (q) {
        await db.update(quotes).set({ dealId: dealId, updatedAt: new Date() }).where(eq(quotes.id, q.id));
      }
    }
  }
  if (!q) return { ok: false, reason: "no_quote" };

  const currentIdx = WORKFLOW_ORDER.indexOf(q.workflowStage as (typeof WORKFLOW_ORDER)[number]);
  const confirmedIdx = WORKFLOW_ORDER.indexOf("confirmed");
  if (currentIdx >= confirmedIdx) {
    return { ok: false, reason: "already_past_confirmed" };
  }

  await db.update(quotes).set({ workflowStage: "confirmed", updatedAt: new Date() }).where(eq(quotes.id, q.id));

  let createdWorkOrderId: string | null = null;
  const [existingWo] = await db.select().from(workOrders).where(eq(workOrders.quoteId, q.id)).limit(1);
  if (!existingWo) {
    const woNumber = `WO-${Date.now().toString().slice(-7)}`;
    const [d] = await db.select({ customerId: deals.customerId }).from(deals).where(eq(deals.id, dealId));
    const [wo] = await db
      .insert(workOrders)
      .values({
        woNumber,
        customerId: d?.customerId ?? null,
        quoteId: q.id,
        status: "confirmed",
      })
      .returning();
    createdWorkOrderId = wo?.id ?? null;
  } else {
    await db.update(workOrders).set({ status: "confirmed", updatedAt: new Date() }).where(eq(workOrders.id, existingWo.id));
  }

  return { ok: true, promotedQuoteId: q.id, createdWorkOrderId };
}

// Soft pipeline-document reminder. When a deal advances to / past the
// pipeline document's `requiredBeforeStage` without the doc attached,
// drop an open task on the deal so the assignee chases it down. Deduped
// per kind so we don't spam tasks every time the stage is touched.
export async function maybeCreateDocReminder(
  dealId: string,
  newStage: string,
  prevStage: string,
): Promise<{ created: boolean; taskId: string | null }> {
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) return { created: false, taskId: null };

  const pipeline = getPipeline(d.pipeline);
  const docSpec = docForPipeline(pipeline.slug);
  if (!docSpec) return { created: false, taskId: null };

  const stages = pipeline.stages;
  const requiredIdx = stages.indexOf(docSpec.requiredBeforeStage as (typeof stages)[number]);
  const newIdx = stages.indexOf(newStage as (typeof stages)[number]);
  const prevIdx = stages.indexOf(prevStage as (typeof stages)[number]);
  if (requiredIdx < 0 || newIdx < 0) return { created: false, taskId: null };
  // Only fire on the forward edge into the requirement.
  if (newIdx < requiredIdx) return { created: false, taskId: null };
  if (prevIdx >= requiredIdx) return { created: false, taskId: null };

  // Skip if the doc is already attached.
  const [existingDoc] = await db
    .select({ id: customerDocuments.id })
    .from(customerDocuments)
    .where(and(
      eq(customerDocuments.associatedDealId, dealId),
      eq(customerDocuments.kind, docSpec.slug),
      eq(customerDocuments.isCurrentVersion, true),
    ))
    .limit(1);
  if (existingDoc) return { created: false, taskId: null };

  // Dedup: skip if an open reminder for this kind already exists on the deal.
  const reminderTitle = `Upload ${docSpec.label}`;
  const [existingTask] = await db
    .select({ id: dealTasks.id })
    .from(dealTasks)
    .where(and(
      eq(dealTasks.dealId, dealId),
      eq(dealTasks.title, reminderTitle),
      isNull(dealTasks.completedAt),
    ))
    .limit(1);
  if (existingTask) return { created: false, taskId: existingTask.id };

  const [task] = await db
    .insert(dealTasks)
    .values({
      dealId,
      title: reminderTitle,
      description: `${pipeline.label} expects this paperwork by ${docSpec.requiredBeforeStage.replace(/_/g, " ")}. Generate or upload it from the deal's Documents tab.`,
      assignedTo: d.assignedTo,
      department: "sales",
    })
    .returning();
  await db.insert(dealActivity).values({
    dealId,
    kind: "doc_reminder_created",
    body: `Reminder: ${reminderTitle}`,
  });
  return { created: true, taskId: task?.id ?? null };
}
