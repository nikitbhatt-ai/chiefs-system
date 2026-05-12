import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users, dealActivity, dealTasks, quotes } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { PIPELINE_BUCKETS, bucketForStage, cardAge } from "@/lib/pipelineBuckets";
import { slaForAll } from "@/lib/slaResolver";
import { getPipeline, PIPELINE_SLUGS, PIPELINES, stagesFor, stageLabel } from "@/lib/pipelines";
import { KanbanBoard, type KanbanCard } from "./KanbanBoard";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [dealRows, customerRows, userRows, resolveSla] = await Promise.all([
    db.select().from(deals).orderBy(desc(deals.updatedAt)),
    db.select({ id: customers.id, name: customers.name, type: customers.type }).from(customers).orderBy(customers.name),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.active, true)),
    slaForAll(),
  ]);

  const customerMap = new Map(customerRows.map((c) => [c.id, c.name]));
  const userMap = new Map(userRows.map((u) => [u.id, u.name ?? u.email]));

  // Bulk-load latest activity + open task counts + linked quote counts so the
  // popup modal renders without a follow-up fetch.
  const dealIds = dealRows.map((d) => d.id);
  const [latestActivities, openTasks, quoteRows] = dealIds.length
    ? await Promise.all([
        db.select().from(dealActivity).where(inArray(dealActivity.dealId, dealIds)).orderBy(desc(dealActivity.createdAt)),
        db.select({ id: dealTasks.id, dealId: dealTasks.dealId, completedAt: dealTasks.completedAt }).from(dealTasks).where(inArray(dealTasks.dealId, dealIds)),
        db.select({ id: quotes.id, dealId: quotes.dealId, quoteNumber: quotes.quoteNumber, workflowStage: quotes.workflowStage }).from(quotes).where(inArray(quotes.dealId, dealIds)),
      ])
    : [[], [], []] as const;

  const latestActivityByDeal = new Map<string, { kind: string; body: string | null; createdAt: Date }>();
  for (const a of latestActivities) {
    if (!latestActivityByDeal.has(a.dealId)) {
      latestActivityByDeal.set(a.dealId, { kind: a.kind, body: a.body, createdAt: a.createdAt });
    }
  }
  const openTasksByDeal = new Map<string, number>();
  for (const t of openTasks) if (!t.completedAt) openTasksByDeal.set(t.dealId, (openTasksByDeal.get(t.dealId) ?? 0) + 1);
  const quotesByDeal = new Map<string, { id: string; quoteNumber: string | null; workflowStage: string }[]>();
  for (const q of quoteRows) {
    if (!q.dealId) continue;
    const arr = quotesByDeal.get(q.dealId) ?? [];
    arr.push({ id: q.id, quoteNumber: q.quoteNumber, workflowStage: q.workflowStage });
    quotesByDeal.set(q.dealId, arr);
  }

  const cards: KanbanCard[] = dealRows
    .map((d) => {
      const bucket = bucketForStage(d.stage);
      if (!bucket) return null;
      const sla = resolveSla(d.pipeline, d.stage);
      const age = cardAge(d.currentStageEnteredAt, sla);
      const daysInStage = d.currentStageEnteredAt
        ? Math.floor((Date.now() - new Date(d.currentStageEnteredAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const pipeline = getPipeline(d.pipeline);
      const vehicle = [d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" ");
      const activity = latestActivityByDeal.get(d.id) ?? null;
      const dealQuotes = quotesByDeal.get(d.id) ?? [];
      return {
        id: d.id,
        customerId: d.customerId,
        customerName: d.customerId ? customerMap.get(d.customerId) ?? "—" : "—",
        vehicle: vehicle || null,
        vin: d.vin,
        notes: d.notes,
        stage: d.stage,
        subStatus: d.subStatus ?? null,
        bucket,
        pipelineLabel: pipeline.label,
        pipelineSlug: pipeline.slug,
        availableStages: stagesFor(pipeline.slug).map((s) => ({ value: s, label: stageLabel(s) })),
        assignedTo: d.assignedTo ? userMap.get(d.assignedTo) ?? null : null,
        age,
        daysInStage,
        latestActivity: activity ? { kind: activity.kind, body: activity.body, createdAt: activity.createdAt.toISOString() } : null,
        openTaskCount: openTasksByDeal.get(d.id) ?? 0,
        quotes: dealQuotes,
      } as KanbanCard;
    })
    .filter((c): c is KanbanCard => c !== null);

  const pipelineOptions = PIPELINE_SLUGS.map((slug) => ({
    slug,
    label: PIPELINES[slug].label,
    stages: PIPELINES[slug].stages.map((s) => ({ value: s, label: stageLabel(s) })),
  }));
  const customerOptions = customerRows.map((c) => ({ id: c.id, name: c.name }));

  return (
    <AppShell title="Pipeline" subtitle="Kanban across the 7 deal-flow buckets">
      <KanbanBoard
        buckets={PIPELINE_BUCKETS}
        cards={cards}
        customers={customerOptions}
        pipelines={pipelineOptions}
      />
    </AppShell>
  );
}
