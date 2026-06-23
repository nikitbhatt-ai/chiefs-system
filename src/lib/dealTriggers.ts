// Cross-system triggers fired off the back of deal stage changes.
//
// Today: when a deal advances into the Won bucket (po_received for
// Government, deposit_received for Walk-In Credentialed and Commercial),
// promote the deal's most recent quote from estimate to confirmed and
// auto-create a work order if none exists yet. One-way trigger: moving
// the deal back out of Won does NOT reverse the workflow.

import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deals, quotes, workOrders, dealTasks, customerDocuments, dealActivity, users } from "@/db/schema";
import { bucketForStage } from "@/lib/pipelineBuckets";
import { docForPipeline } from "@/lib/documentTemplates";
import { getPipeline, stageLabel, type DealStage } from "@/lib/pipelines";
import { notify } from "@/lib/notifications";
import { loadStageMapping, mapCrmToWorkflow, mapWorkflowToCrm, WORKFLOW_STAGE_LABELS } from "@/lib/stageMapping";

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
  | { ok: true; promotedQuoteId: string; createdWorkOrderId: string | null; workOrderId: string | null }
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
  const quoteId = q.id;

  const [d] = await db.select({ customerId: deals.customerId }).from(deals).where(eq(deals.id, dealId));

  // The promotion runs inside a transaction with the quote row locked
  // FOR UPDATE. Two concurrent moves into the Won bucket therefore serialize:
  // the second sees workflowStage = 'confirmed' and bails before creating a
  // second work order. The work order is stamped with dealId so the
  // CRM->Workflow sync that runs right after finds it (by deal_id) instead of
  // creating its own duplicate.
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!locked) return { ok: false, reason: "no_quote" };

    const currentIdx = WORKFLOW_ORDER.indexOf(locked.workflowStage as (typeof WORKFLOW_ORDER)[number]);
    const confirmedIdx = WORKFLOW_ORDER.indexOf("confirmed");
    if (currentIdx >= confirmedIdx) {
      return { ok: false, reason: "already_past_confirmed" };
    }

    await tx.update(quotes).set({ workflowStage: "confirmed", updatedAt: new Date() }).where(eq(quotes.id, quoteId));

    let createdWorkOrderId: string | null = null;
    let workOrderId: string | null = null;
    const [existingWo] = await tx.select().from(workOrders).where(eq(workOrders.quoteId, quoteId)).limit(1).for("update");
    if (!existingWo) {
      const woNumber = `WO-${Date.now().toString().slice(-7)}`;
      const [wo] = await tx
        .insert(workOrders)
        .values({
          woNumber,
          customerId: d?.customerId ?? null,
          quoteId,
          dealId,
          status: "confirmed",
        })
        .returning();
      createdWorkOrderId = wo?.id ?? null;
      workOrderId = wo?.id ?? null;
    } else {
      await tx
        .update(workOrders)
        .set({ status: "confirmed", dealId: existingWo.dealId ?? dealId, updatedAt: new Date() })
        .where(eq(workOrders.id, existingWo.id));
      workOrderId = existingWo.id;
    }

    return { ok: true, promotedQuoteId: quoteId, createdWorkOrderId, workOrderId };
  });
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
  if (d.assignedTo) {
    await notify(d.assignedTo, {
      kind: "doc_reminder",
      title: `Reminder: ${reminderTitle}`,
      body: `${pipeline.label} expects this paperwork by ${docSpec.requiredBeforeStage.replace(/_/g, " ")}.`,
      link: `/deals/${dealId}?tab=tasks`,
      dealId,
    });
  }
  return { created: true, taskId: task?.id ?? null };
}

// CRM -> Workflow one-way sync. Whenever a deal's CRM stage changes,
// find the work order that represents this deal (linked via deal_id, or
// indirectly via the deal's most recent quote) and update its status to
// the mapped workflow stage. Creates a work order on first cross into a
// shop-visible stage. Skips when:
//   - the mapped workflow stage is null (CRM stage is pre-shop)
//   - the new and previous stages map to the same workflow stage
// On the lost transition the WO is parked at status="archived" so it
// drops off the active board but stays accessible for audit.
export async function syncDealToWorkflow(
  dealId: string,
  newStage: string,
  prevStage: string | null,
): Promise<
  | { ok: true; workOrderId: string; workflowStage: string; created: boolean }
  | { ok: false; reason: "no_target" | "same_target" | "no_deal" }
> {
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) return { ok: false, reason: "no_deal" };

  const mapping = await loadStageMapping();
  const target = mapCrmToWorkflow(newStage, mapping);
  if (!target) return { ok: false, reason: "no_target" };

  if (prevStage) {
    const prevTarget = mapCrmToWorkflow(prevStage, mapping);
    if (prevTarget === target) return { ok: false, reason: "same_target" };
  }

  // 1) Direct link by deal_id. 2) Fallback to a WO linked through a quote
  // that already references this deal. 3) Otherwise create a new WO.
  let [wo] = await db.select().from(workOrders).where(eq(workOrders.dealId, dealId)).limit(1);
  if (!wo) {
    const [q] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.dealId, dealId))
      .orderBy(desc(quotes.updatedAt))
      .limit(1);
    if (q) {
      const [woByQuote] = await db.select().from(workOrders).where(eq(workOrders.quoteId, q.id)).limit(1);
      if (woByQuote) {
        await db.update(workOrders).set({ dealId, updatedAt: new Date() }).where(eq(workOrders.id, woByQuote.id));
        wo = { ...woByQuote, dealId };
      }
    }
  }

  let created = false;
  if (!wo) {
    if (target === "archived") {
      // Don't materialize a brand-new archived WO for a deal that never
      // had one. Just record the sync on the activity feed and bail.
      await db.insert(dealActivity).values({
        dealId,
        kind: "workflow_sync",
        body: `Deal lost — no workflow record to archive.`,
      });
      return { ok: false, reason: "no_target" };
    }
    const woNumber = `WO-${Date.now().toString().slice(-7)}`;
    const [q] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.dealId, dealId))
      .orderBy(desc(quotes.updatedAt))
      .limit(1);
    const [inserted] = await db
      .insert(workOrders)
      .values({
        woNumber,
        customerId: d.customerId ?? null,
        quoteId: q?.id ?? null,
        dealId,
        status: target,
      })
      .returning();
    wo = inserted;
    created = true;
  } else if (wo.status !== target) {
    await db.update(workOrders).set({ status: target, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
  }

  const label = WORKFLOW_STAGE_LABELS[target] ?? target;
  await db.insert(dealActivity).values({
    dealId,
    kind: "workflow_sync",
    body: created
      ? `Auto-synced: created workflow record at "${label}" (from CRM stage ${newStage.replace(/_/g, " ")}).`
      : `Auto-synced to workflow: ${label} (from CRM stage ${newStage.replace(/_/g, " ")}).`,
    metadata: { workflowStage: target, workOrderId: wo!.id, source: "crm_stage_change" },
  });

  await notifyShopSide(dealId, wo!.id, wo!.assignedTo, label, newStage);

  return { ok: true, workOrderId: wo!.id, workflowStage: target, created };
}

// Workflow -> CRM reverse sync. When a work order's status changes on the
// /workflow board, push the corresponding CRM stage on the linked deal so
// sales sees the same source of truth. Pipeline-aware: "confirmed" maps to
// po_received for government deals and deposit_received otherwise.
// Intermediate shop states (awaiting_parts / next_in_line / qc_check /
// completed) keep the CRM stage at in_production so we don't oscillate
// sales' view while the shop iterates internally.
export async function syncWorkflowToDeal(
  workOrderId: string,
  newWorkflowStage: string,
  prevWorkflowStage: string | null,
): Promise<
  | { ok: true; dealId: string; newCrmStage: string; prevCrmStage: string }
  | { ok: false; reason: "no_deal" | "no_target" | "same_target" | "no_change" }
> {
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo?.dealId) return { ok: false, reason: "no_deal" };

  const [d] = await db.select().from(deals).where(eq(deals.id, wo.dealId));
  if (!d) return { ok: false, reason: "no_deal" };

  const targetCrm = mapWorkflowToCrm(newWorkflowStage, d.pipeline);
  if (!targetCrm) return { ok: false, reason: "no_target" };

  if (prevWorkflowStage) {
    const prevCrm = mapWorkflowToCrm(prevWorkflowStage, d.pipeline);
    if (prevCrm === targetCrm) return { ok: false, reason: "same_target" };
  }

  if (d.stage === targetCrm) return { ok: false, reason: "no_change" };

  await db
    .update(deals)
    .set({ stage: targetCrm as DealStage, currentStageEnteredAt: new Date(), updatedAt: new Date() })
    .where(eq(deals.id, d.id));

  const wfLabel = WORKFLOW_STAGE_LABELS[newWorkflowStage] ?? newWorkflowStage;
  await db.insert(dealActivity).values({
    dealId: d.id,
    kind: "workflow_sync",
    body: `Auto-synced from workflow: ${wfLabel} → CRM stage ${stageLabel(targetCrm)}.`,
    metadata: { workflowStage: newWorkflowStage, workOrderId: wo.id, newCrmStage: targetCrm, source: "workflow_stage_change" },
  });

  await notifySalesSide(d.id, d.assignedTo, targetCrm, wfLabel);

  return { ok: true, dealId: d.id, newCrmStage: targetCrm, prevCrmStage: d.stage };
}

// Notify the shop side when sales moves a deal: the WO assignee if any,
// otherwise users with manager / admin roles. Skips silently if no one is
// reachable so this never blocks the parent transaction.
async function notifyShopSide(
  dealId: string,
  workOrderId: string,
  woAssignedTo: string | null,
  workflowLabel: string,
  crmStage: string,
) {
  const title = `Deal moved to ${workflowLabel}`;
  const body = `Sales advanced this deal to ${crmStage.replace(/_/g, " ")}; workflow record is now ${workflowLabel}.`;
  const link = `/workflow`;
  if (woAssignedTo) {
    await notify(woAssignedTo, { kind: "stage_change", title, body, link, dealId });
    return;
  }
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.active, true), inArray(users.role, ["manager", "admin"])));
  for (const r of recipients) {
    await notify(r.id, { kind: "stage_change", title, body, link, dealId });
  }
  void workOrderId;
}

// Notify the sales side when the shop moves a workflow stage: the deal's
// assignee. If none is set, fall back to users with role=sales.
async function notifySalesSide(
  dealId: string,
  dealAssignedTo: string | null,
  crmStage: string,
  workflowLabel: string,
) {
  const title = `Shop update: ${workflowLabel}`;
  const body = `Shop moved this build to ${workflowLabel}; CRM stage is now ${crmStage.replace(/_/g, " ")}.`;
  const link = `/deals/${dealId}`;
  if (dealAssignedTo) {
    await notify(dealAssignedTo, { kind: "stage_change", title, body, link, dealId });
    return;
  }
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.active, true), eq(users.role, "sales")));
  for (const r of recipients) {
    await notify(r.id, { kind: "stage_change", title, body, link, dealId });
  }
}
