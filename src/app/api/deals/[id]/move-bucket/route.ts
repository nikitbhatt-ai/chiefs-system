import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { stageForBucket, type BucketSlug, PIPELINE_BUCKETS } from "@/lib/pipelineBuckets";
import { canOverrideStageGate } from "@/lib/rbac";
import { applyDealStageChange } from "@/lib/dealStage";

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
  if (body?.override === true && !canOverrideStageGate(session)) {
    return NextResponse.json({ error: "Only managers can override stage gates." }, { status: 403 });
  }

  // The kanban speaks in buckets; resolve to the pipeline-specific stage, then
  // route through the single guarded transition (same as the stage endpoint).
  const [d] = await db.select({ pipeline: deals.pipeline }).from(deals).where(eq(deals.id, id));
  if (!d) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const targetStage = stageForBucket(d.pipeline, bucket);
  if (!targetStage) {
    return NextResponse.json(
      { error: `The ${d.pipeline ?? "default"} pipeline has no stage in the ${bucket} bucket.` },
      { status: 400 },
    );
  }

  const result = await applyDealStageChange(id, targetStage, {
    userId: session.user.id,
    override: body?.override === true,
    reason: body?.reason,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        overridable: result.overridable,
        requiresReason: result.requiresReason,
        backwards: result.backwards,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    stage: result.stage,
    promotedQuoteId: result.promotedQuoteId,
    createdWorkOrderId: result.createdWorkOrderId,
    reminderTaskId: result.reminderTaskId,
    workflowSync: result.workflowSync,
  });
}
