import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, dealCredentials } from "@/db/schema";
import { canAdvanceTo, type DealStage } from "@/lib/pipelines";
import { isCredentialActive } from "@/lib/credentials";
import { stageForBucket, type BucketSlug, PIPELINE_BUCKETS } from "@/lib/pipelineBuckets";
import { maybeCreateDocReminder, maybePromoteWonDeal, syncDealToWorkflow } from "@/lib/dealTriggers";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const bucket = (body?.bucket ?? "") as BucketSlug;
  if (!PIPELINE_BUCKETS.some((b) => b.slug === bucket)) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }

  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const targetStage = stageForBucket(d.pipeline, bucket);
  if (!targetStage) {
    return NextResponse.json(
      { error: `The ${d.pipeline ?? "default"} pipeline has no stage in the ${bucket} bucket.` },
      { status: 400 },
    );
  }
  if (targetStage === (d.stage as DealStage)) {
    return NextResponse.json({ ok: true, stage: d.stage });
  }

  const creds = await db
    .select({ verifiedAt: dealCredentials.verifiedAt, expiresAt: dealCredentials.expiresAt })
    .from(dealCredentials)
    .where(eq(dealCredentials.dealId, id));
  const hasActiveCredential = creds.some((c) => isCredentialActive(c));

  const transition = canAdvanceTo(d.pipeline, d.stage, targetStage, { hasActiveCredential });
  if (!transition.ok) {
    return NextResponse.json({ error: transition.reason }, { status: 400 });
  }

  await db
    .update(deals)
    .set({ stage: targetStage, currentStageEnteredAt: new Date(), updatedAt: new Date() })
    .where(eq(deals.id, id));

  const promotion = await maybePromoteWonDeal(id, targetStage, d.stage);
  const reminder = await maybeCreateDocReminder(id, targetStage, d.stage);
  const sync = await syncDealToWorkflow(id, targetStage, d.stage);

  return NextResponse.json({
    ok: true,
    stage: targetStage,
    promotedQuoteId: promotion.ok ? promotion.promotedQuoteId : null,
    createdWorkOrderId: promotion.ok ? promotion.createdWorkOrderId : null,
    reminderTaskId: reminder.taskId,
    workflowSync: sync.ok ? { workOrderId: sync.workOrderId, workflowStage: sync.workflowStage, created: sync.created } : null,
  });
}
