import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pipelineStageSla } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { PIPELINES, PIPELINE_SLUGS, type PipelineSlug, stageLabel } from "@/lib/pipelines";
import { DEFAULT_BUCKET_SLA, bucketForStage } from "@/lib/pipelineBuckets";

export const dynamic = "force-dynamic";

async function saveSla(formData: FormData) {
  "use server";
  const pipelineSlug = String(formData.get("pipelineSlug") ?? "");
  const stage = String(formData.get("stage") ?? "");
  const warningDays = Math.max(0, Number(formData.get("warningDays") ?? "0"));
  const overdueDays = Math.max(0, Number(formData.get("overdueDays") ?? "0"));
  if (!pipelineSlug || !stage) return;

  const [existing] = await db
    .select({ id: pipelineStageSla.id })
    .from(pipelineStageSla)
    .where(and(eq(pipelineStageSla.pipelineSlug, pipelineSlug), eq(pipelineStageSla.stage, stage)))
    .limit(1);
  if (existing) {
    await db
      .update(pipelineStageSla)
      .set({ warningDays, overdueDays, updatedAt: new Date() })
      .where(eq(pipelineStageSla.id, existing.id));
  } else {
    await db.insert(pipelineStageSla).values({ pipelineSlug, stage, warningDays, overdueDays });
  }
  revalidatePath("/settings/sla");
  revalidatePath("/pipeline");
}

async function resetSla(formData: FormData) {
  "use server";
  const pipelineSlug = String(formData.get("pipelineSlug") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!pipelineSlug || !stage) return;
  await db
    .delete(pipelineStageSla)
    .where(and(eq(pipelineStageSla.pipelineSlug, pipelineSlug), eq(pipelineStageSla.stage, stage)));
  revalidatePath("/settings/sla");
  revalidatePath("/pipeline");
}

export default async function SlaSettingsPage() {
  const rows = await db.select().from(pipelineStageSla);
  const map = new Map<string, { warningDays: number; overdueDays: number }>();
  for (const r of rows) map.set(`${r.pipelineSlug}::${r.stage}`, { warningDays: r.warningDays, overdueDays: r.overdueDays });

  return (
    <AppShell title="Stage SLAs" subtitle="Card-aging thresholds per pipeline stage. Cards turn yellow at warning and red at overdue.">
      <div className="space-y-4">
        {PIPELINE_SLUGS.map((slug) => {
          const pipeline = PIPELINES[slug as PipelineSlug];
          return (
            <div key={slug} className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">{pipeline.label}</h3>
                <span className="text-[10px] font-body text-zinc-500">{pipeline.description}</span>
              </div>
              <table className="w-full text-xs font-body">
                <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-2 py-1">Stage</th>
                    <th className="px-2 py-1">Bucket</th>
                    <th className="px-2 py-1">Warning (days)</th>
                    <th className="px-2 py-1">Overdue (days)</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody className="text-zinc-200">
                  {pipeline.stages.filter((s) => s !== "lost").map((stage) => {
                    const bucket = bucketForStage(stage);
                    const stored = map.get(`${slug}::${stage}`);
                    const fallback = bucket ? DEFAULT_BUCKET_SLA[bucket] : { warningDays: 7, overdueDays: 14 };
                    const current = stored ?? fallback;
                    return (
                      <tr key={stage} className="border-t border-white/5">
                        <td className="px-2 py-1.5">{stageLabel(stage)}</td>
                        <td className="px-2 py-1.5 text-zinc-400 capitalize">{bucket ?? "—"}</td>
                        <td className="px-2 py-1.5" colSpan={3}>
                          <form action={saveSla} className="flex items-center gap-2">
                            <input type="hidden" name="pipelineSlug" value={slug} />
                            <input type="hidden" name="stage" value={stage} />
                            <input
                              name="warningDays"
                              type="number"
                              min={0}
                              defaultValue={current.warningDays}
                              className="w-20 bg-black/40 border border-white/10 rounded px-2 py-0.5 text-xs text-white"
                            />
                            <span className="text-zinc-600">/</span>
                            <input
                              name="overdueDays"
                              type="number"
                              min={0}
                              defaultValue={current.overdueDays}
                              className="w-20 bg-black/40 border border-white/10 rounded px-2 py-0.5 text-xs text-white"
                            />
                            <button type="submit" className="text-[10px] text-amber-400 hover:text-amber-300">Save</button>
                            {stored ? (
                              <button
                                formAction={resetSla}
                                className="text-[10px] text-zinc-500 hover:text-red-400"
                              >
                                Reset to default
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-600">(default)</span>
                            )}
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
