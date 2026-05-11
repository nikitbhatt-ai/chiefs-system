// Cross-system triggers fired off the back of deal stage changes.
//
// Today: when a deal advances into the Won bucket (po_received for
// Government, deposit_received for Walk-In Credentialed and Commercial),
// promote the deal's most recent quote from estimate to confirmed and
// auto-create a work order if none exists yet. One-way trigger: moving
// the deal back out of Won does NOT reverse the workflow.

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, quotes, workOrders } from "@/db/schema";
import { bucketForStage } from "@/lib/pipelineBuckets";

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

  const [q] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.dealId, dealId))
    .orderBy(desc(quotes.updatedAt))
    .limit(1);
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
