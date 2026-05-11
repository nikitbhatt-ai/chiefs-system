import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, customers, users } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { PIPELINE_BUCKETS, bucketForStage, cardAge } from "@/lib/pipelineBuckets";
import { slaForAll } from "@/lib/slaResolver";
import { getPipeline } from "@/lib/pipelines";
import { KanbanBoard, type KanbanCard } from "./KanbanBoard";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [dealRows, customerRows, userRows, resolveSla] = await Promise.all([
    db.select().from(deals).orderBy(desc(deals.updatedAt)),
    db.select({ id: customers.id, name: customers.name }).from(customers),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    slaForAll(),
  ]);

  const customerMap = new Map(customerRows.map((c) => [c.id, c.name]));
  const userMap = new Map(userRows.map((u) => [u.id, u.name ?? u.email]));

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
      return {
        id: d.id,
        customerId: d.customerId,
        customerName: d.customerId ? customerMap.get(d.customerId) ?? "—" : "—",
        vehicle: vehicle || null,
        stage: d.stage,
        subStatus: d.subStatus ?? null,
        bucket,
        pipelineLabel: pipeline.label,
        pipelineSlug: pipeline.slug,
        assignedTo: d.assignedTo ? userMap.get(d.assignedTo) ?? null : null,
        age,
        daysInStage,
      } as KanbanCard;
    })
    .filter((c): c is KanbanCard => c !== null);

  return (
    <AppShell title="Pipeline" subtitle="Kanban across the 7 deal-flow buckets">
      <KanbanBoard buckets={PIPELINE_BUCKETS} cards={cards} />
    </AppShell>
  );
}
