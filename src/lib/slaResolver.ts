import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pipelineStageSla } from "@/db/schema";
import { DEFAULT_BUCKET_SLA, bucketForStage } from "@/lib/pipelineBuckets";

// Resolve SLA thresholds for a deal's current (pipeline, stage). DB row
// overrides defaults. Called per-deal on the kanban view to colour cards.
export async function slaFor(pipelineSlug: string | null | undefined, stage: string) {
  if (pipelineSlug) {
    const [row] = await db
      .select({ warningDays: pipelineStageSla.warningDays, overdueDays: pipelineStageSla.overdueDays })
      .from(pipelineStageSla)
      .where(and(eq(pipelineStageSla.pipelineSlug, pipelineSlug), eq(pipelineStageSla.stage, stage)))
      .limit(1);
    if (row) return { warningDays: row.warningDays, overdueDays: row.overdueDays };
  }
  const bucket = bucketForStage(stage);
  if (bucket) return DEFAULT_BUCKET_SLA[bucket];
  return { warningDays: 7, overdueDays: 14 };
}

// Bulk resolve for the kanban: one query for all SLA rows then a map lookup.
export async function slaForAll() {
  const rows = await db
    .select({
      pipelineSlug: pipelineStageSla.pipelineSlug,
      stage: pipelineStageSla.stage,
      warningDays: pipelineStageSla.warningDays,
      overdueDays: pipelineStageSla.overdueDays,
    })
    .from(pipelineStageSla);
  const map = new Map<string, { warningDays: number; overdueDays: number }>();
  for (const r of rows) map.set(`${r.pipelineSlug}::${r.stage}`, { warningDays: r.warningDays, overdueDays: r.overdueDays });
  return function resolve(pipelineSlug: string | null | undefined, stage: string) {
    if (pipelineSlug) {
      const hit = map.get(`${pipelineSlug}::${stage}`);
      if (hit) return hit;
    }
    const bucket = bucketForStage(stage);
    if (bucket) return DEFAULT_BUCKET_SLA[bucket];
    return { warningDays: 7, overdueDays: 14 };
  };
}
