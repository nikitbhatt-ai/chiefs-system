import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { quotes, workOrders } from "@/db/schema";
import { syncWorkflowToDeal } from "@/lib/dealTriggers";
import { consumeWorkOrderParts, restoreWorkOrderParts } from "@/lib/inventory";
import { qcComplete } from "@/lib/qc";

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

// A build can't start (move into in_progress or beyond) until the quote has
// been approved. "converted" sits after "approved" in the status workflow, so
// it counts as approved too. This is the single gate that also protects the
// inventory deduction, which is keyed to the same in_progress crossing.
const BUILD_START_INDEX = STAGE_KEYS.indexOf("in_progress");
const STATUSES_CLEARED_TO_BUILD = new Set(["approved", "converted"]);

// POST /api/quotes/[id]/workflow-stage  body: { stage }
// The single path for quote-side workflow moves — used by both the
// /workflow Kanban and the /quotes/[id] workflow strip. Enforces the
// approval gate, updates the WO status (creating one if needed and the
// target isn't 'estimate'), stamps deal_id from the quote when present,
// deducts parts when stage flips to in_progress for the first time,
// updates quotes.workflow_stage, then best-effort triggers the reverse
// CRM sync.
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
        status: quotes.status,
        workflowStage: quotes.workflowStage,
      })
      .from(quotes)
      .where(eq(quotes.id, id));
    if (!q) return NextResponse.json({ error: "quote not found" }, { status: 404 });

    // Approval gate: don't let a build start (and don't deduct inventory)
    // until the quote is approved. Bail before creating/updating the work
    // order or touching stock.
    const targetIndex = STAGE_KEYS.indexOf(stage);
    if (targetIndex >= BUILD_START_INDEX && !STATUSES_CLEARED_TO_BUILD.has(q.status)) {
      return NextResponse.json(
        {
          error:
            "Approve the quote before starting the build. Set the quote's status to Approved, then move it to In Progress.",
          needsApproval: true,
        },
        { status: 400 },
      );
    }

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

    // Build-close gate: a build can't move into completed/delivered until its
    // QC checklist fully passes. No work order (hence no checklist) = not ready.
    if (stage === "completed" || stage === "delivered") {
      const passed = wo ? await qcComplete(wo.id) : false;
      if (!passed) {
        return NextResponse.json(
          { error: "QC checklist must be fully passed before this build can be closed.", qcIncomplete: true },
          { status: 400 },
        );
      }
    }

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
      if (targetIndex >= BUILD_START_INDEX) {
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
