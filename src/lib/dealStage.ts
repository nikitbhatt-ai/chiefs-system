// Single authoritative deal-stage transition.
//
// Every path that changes a deal's CRM stage — POST /api/deals/[id]/stage,
// POST /api/deals/[id]/move-bucket, PATCH /api/deals/[id], and the
// /deals/[id]/edit server action — MUST go through applyDealStageChange so the
// same guardrails fire everywhere:
//   - canAdvanceTo validation (one-step-forward, credential hard gate),
//   - manager override + backwards-move reason capture into stage_overrides,
//   - the Won auto-promotion, pipeline-doc reminder, and CRM->Workflow sync.
//
// Before this existed, the generic PATCH route wrote `stage` directly, skipping
// every gate (a walk-in deal could jump straight to delivered with no verified
// credential and no audit row). This module is the chokepoint that prevents it.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, dealCredentials, stageOverrides, dealActivity } from "@/db/schema";
import { canAdvanceTo, stageLabel, type DealStage } from "@/lib/pipelines";
import { isCredentialActive } from "@/lib/credentials";
import { maybeCreateDocReminder, maybePromoteWonDeal, syncDealToWorkflow } from "@/lib/dealTriggers";

export type StageChangeOk = {
  ok: true;
  stage: string;
  unchanged: boolean;
  promotedQuoteId: string | null;
  createdWorkOrderId: string | null;
  reminderTaskId: string | null;
  workflowSync: { workOrderId: string; workflowStage: string; created: boolean } | null;
};

export type StageChangeErr = {
  ok: false;
  status: number;
  error: string;
  overridable?: boolean;
  requiresReason?: boolean;
  backwards?: boolean;
};

export type StageChangeResult = StageChangeOk | StageChangeErr;

export async function applyDealStageChange(
  dealId: string,
  targetStage: string,
  opts: { userId?: string | null; override?: boolean; reason?: string } = {},
): Promise<StageChangeResult> {
  const override = opts.override === true;
  const reason = String(opts.reason ?? "").trim();

  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) return { ok: false, status: 404, error: "Deal not found" };

  if (targetStage === d.stage) {
    return {
      ok: true,
      stage: d.stage,
      unchanged: true,
      promotedQuoteId: null,
      createdWorkOrderId: null,
      reminderTaskId: null,
      workflowSync: null,
    };
  }

  const creds = await db
    .select({ verifiedAt: dealCredentials.verifiedAt, expiresAt: dealCredentials.expiresAt })
    .from(dealCredentials)
    .where(eq(dealCredentials.dealId, dealId));
  const hasActiveCredential = creds.some((c) => isCredentialActive(c));

  const transition = canAdvanceTo(d.pipeline, d.stage, targetStage, { hasActiveCredential, override });
  if (!transition.ok) {
    return {
      ok: false,
      status: 400,
      error: transition.reason ?? "Invalid stage transition",
      overridable: transition.overridable === true,
    };
  }

  const isBackwards = transition.backwards === true;
  if ((override || isBackwards) && !reason) {
    return {
      ok: false,
      status: 400,
      error: isBackwards ? "Moving a deal backwards requires a reason." : "Override requires a reason.",
      requiresReason: true,
      backwards: isBackwards,
    };
  }

  await db
    .update(deals)
    .set({ stage: targetStage as DealStage, currentStageEnteredAt: new Date(), updatedAt: new Date() })
    .where(eq(deals.id, dealId));

  if (override || isBackwards) {
    const kind = override ? "skip_override" : "backwards";
    await db.insert(stageOverrides).values({
      dealId,
      kind,
      fromStage: d.stage,
      toStage: targetStage,
      reason,
      userId: opts.userId ?? null,
    });
    await db.insert(dealActivity).values({
      dealId,
      kind: "stage_override",
      body: `${kind === "backwards" ? "Backwards move" : "Forward override"}: ${stageLabel(d.stage)} → ${stageLabel(targetStage)}. Reason: ${reason}`,
      metadata: { kind, fromStage: d.stage, toStage: targetStage },
    });
  }

  const promotion = await maybePromoteWonDeal(dealId, targetStage, d.stage).catch((err) => {
    console.error("maybePromoteWonDeal failed:", err);
    return { ok: false as const, reason: "no_quote" as const };
  });
  const reminder = await maybeCreateDocReminder(dealId, targetStage, d.stage).catch((err) => {
    console.error("maybeCreateDocReminder failed:", err);
    return { created: false, taskId: null };
  });
  const sync = await syncDealToWorkflow(dealId, targetStage, d.stage).catch((err) => {
    console.error("syncDealToWorkflow failed:", err);
    return { ok: false as const, reason: "no_deal" as const };
  });

  return {
    ok: true,
    stage: targetStage,
    unchanged: false,
    promotedQuoteId: promotion.ok ? promotion.promotedQuoteId : null,
    createdWorkOrderId: promotion.ok ? promotion.createdWorkOrderId : null,
    reminderTaskId: reminder.taskId,
    workflowSync: sync.ok
      ? { workOrderId: sync.workOrderId, workflowStage: sync.workflowStage, created: sync.created }
      : null,
  };
}
