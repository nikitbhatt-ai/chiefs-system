import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { workOrders, quotes, customers, vehicles, deals } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { STAGE_COLORS } from "@/lib/pipelines";
import { WorkflowBoard, type WorkflowCard } from "./WorkflowBoard";

export const dynamic = "force-dynamic";

const STAGES = [
  { key: "estimate", label: "Estimates", index: 1 },
  { key: "confirmed", label: "Confirmed Builds", index: 2 },
  { key: "awaiting_parts", label: "Awaiting Parts", index: 3 },
  { key: "next_in_line", label: "Next In Line", index: 4 },
  { key: "in_progress", label: "In Progress", index: 5 },
  { key: "qc_check", label: "QC Check", index: 6 },
  { key: "completed", label: "Completed", index: 7 },
  { key: "delivered", label: "Delivered", index: 8 },
];

export default async function WorkflowPage() {
  // Explicit column projection — see PR #26 for context. Schema drift can't
  // break the render.
  const quoteRows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      customerId: quotes.customerId,
      dealId: quotes.dealId,
      status: quotes.status,
      grandTotal: quotes.grandTotal,
      workflowStage: quotes.workflowStage,
      notes: quotes.notes,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .orderBy(desc(quotes.createdAt));

  const customerIds = Array.from(new Set(quoteRows.map((r) => r.customerId).filter(Boolean) as string[]));
  const linkedWOs = await db
    .select({ id: workOrders.id, quoteId: workOrders.quoteId, vehicleId: workOrders.vehicleId })
    .from(workOrders);
  const woByQuote = new Map(linkedWOs.filter((w) => w.quoteId).map((w) => [w.quoteId as string, w]));
  const vehicleIds = Array.from(new Set(linkedWOs.map((w) => w.vehicleId).filter(Boolean) as string[]));

  const dealIds = Array.from(new Set(quoteRows.map((r) => r.dealId).filter(Boolean) as string[]));
  const dealRows = dealIds.length
    ? await db.select({ id: deals.id, stage: deals.stage }).from(deals).where(inArray(deals.id, dealIds))
    : [];
  const dealStageMap = new Map(dealRows.map((d) => [d.id, d.stage]));

  const [customerRows, vehicleRows] = await Promise.all([
    customerIds.length
      ? db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    vehicleIds.length
      ? db
          .select({ id: vehicles.id, year: vehicles.year, make: vehicles.make, model: vehicles.model, vin: vehicles.vin })
          .from(vehicles)
          .where(inArray(vehicles.id, vehicleIds))
      : Promise.resolve([] as { id: string; year: number | null; make: string | null; model: string | null; vin: string | null }[]),
  ]);
  const customerMap = new Map(customerRows.map((r) => [r.id, r.name]));
  const vehicleMap = new Map(vehicleRows.map((r) => [r.id, r]));

  const cards: WorkflowCard[] = quoteRows.map((q) => {
    const wo = woByQuote.get(q.id);
    const vehicle = wo?.vehicleId ? vehicleMap.get(wo.vehicleId) : null;
    const crmStage = q.dealId ? dealStageMap.get(q.dealId) ?? null : null;
    return {
      id: q.id,
      quoteNumber: q.quoteNumber,
      status: q.status,
      workflowStage: q.workflowStage,
      notes: q.notes,
      customerName: q.customerId ? customerMap.get(q.customerId) ?? null : null,
      vehicle: vehicle
        ? `${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}${vehicle.vin ? ` · ${vehicle.vin}` : ""}`
        : null,
      grandTotal: q.grandTotal,
      dealId: q.dealId,
      crmStage,
      crmStageColor: crmStage ? STAGE_COLORS[crmStage] ?? null : null,
    };
  });

  return (
    <AppShell title="Workflow" subtitle="Build pipeline — drag cards between stages">
      <WorkflowBoard stages={STAGES} cards={cards} />
    </AppShell>
  );
}
