import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { quotes, workOrders } from "@/db/schema";
import { syncWorkflowToDeal } from "@/lib/dealTriggers";
import { consumeWorkOrderParts, restoreWorkOrderParts } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const STAGE_KEYS = [
  "estimate",
  "confirmed",
  "awaiting_parts",
  "next_in_line",
  "in_progress",
  "qc_check",
  "completed",
  "delivered",
];

// POST /api/quotes/[id]/workflow-stage  body: { stage }
// Moves the quote on the /workflow Kanban. Mirrors the existing
// moveQuoteStage server action: updates the WO status (creating one if
// needed and the target isn't 'estimate'), stamps deal_id from the quote
// when present, deducts parts when stage flips to in_progress for the
// first time, updates quotes.workflow_stage, then best-effort triggers
// the reverse CRM sync.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const stage = String(body?.stage ?? "");
  if (!STAGE_KEYS.includes(stage)) return NextResponse.json({ error: "invalid stage" }, { status: 400 });

  try {
    const [q] = await db
      .select({
        id: quotes.id,
        customerId: quotes.customerId,
        dealId: quotes.dealId,
        workflowStage: quotes.workflowStage,
      })
      .from(quotes)
      .where(eq(quotes.id, id));
    if (!q) return NextResponse.json({ error: "quote not found" }, { status: 404 });

    let [wo] = await db
      .select({
        id: workOrders.id,
        customerId: workOrders.customerId,
        quoteId: workOrders.quoteId,
        dealId: workOrders.dealId,
        status: workOrders.status,
        partsConsumed: workOrders.partsConsumed,
      })
      .from(workOrders)
      .where(eq(workOrders.quoteId, id));
    const prevWorkflowStage = wo?.status ?? null;

    if (!wo && stage !== "estimate") {
      const woNumber = `WO-${Date.now().toString().slice(-7)}`;
      const inserted = await db
        .insert(workOrders)
        .values({
          woNumber,
          customerId: q.customerId ?? null,
          quoteId: id,
          dealId: q.dealId ?? null,
          status: stage,
        })
        .returning({
          id: workOrders.id,
          customerId: workOrders.customerId,
          quoteId: workOrders.quoteId,
          dealId: workOrders.dealId,
          status: workOrders.status,
          partsConsumed: workOrders.partsConsumed,
        });
      wo = inserted[0];
    } else if (wo) {
      if (!wo.dealId && q.dealId) {
        await db.update(workOrders).set({ dealId: q.dealId, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
        wo = { ...wo, dealId: q.dealId };
      }
      await db.update(workOrders).set({ status: stage, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
    }

    // Transactional, idempotent FIFO consumption (see src/lib/inventory.ts).
    // Advancing to or past in_progress consumes the quote's parts exactly once;
    // walking the build back before in_progress restores the drained layers.
    if (wo) {
      const idx = STAGE_KEYS.indexOf(stage);
      const inProgressIdx = STAGE_KEYS.indexOf("in_progress");
      if (idx >= inProgressIdx) {
        await consumeWorkOrderParts(wo.id);
      } else {
        await restoreWorkOrderParts(wo.id);
      }
    }

    await db.update(quotes).set({ workflowStage: stage, updatedAt: new Date() }).where(eq(quotes.id, id));

    if (wo?.id) {
      try {
        await syncWorkflowToDeal(wo.id, stage, prevWorkflowStage);
      } catch (err) {
        console.error("syncWorkflowToDeal failed:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      stage,
      workOrderId: wo?.id ?? null,
      dealId: wo?.dealId ?? null,
    });
  } catch (err) {
    console.error("workflow-stage POST failed:", err);
    return NextResponse.json({ error: "stage move failed", detail: String((err as Error).message ?? err) }, { status: 500 });
  }
}
