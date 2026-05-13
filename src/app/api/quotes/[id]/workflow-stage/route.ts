import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { quotes, workOrders, parts, partReceipts } from "@/db/schema";
import { syncWorkflowToDeal } from "@/lib/dealTriggers";

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

type StockLine = { kind?: string; partId?: string; quantity?: number };

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
        lineItems: quotes.lineItems,
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

    if (stage === "in_progress" && wo && !wo.partsConsumed) {
      const lines = (q.lineItems as unknown as StockLine[]) ?? [];
      for (const line of lines) {
        if (line.kind !== "item" || !line.partId) continue;
        const qty = Number(line.quantity || 0);
        if (qty <= 0) continue;
        const layers = await db.select().from(partReceipts).where(eq(partReceipts.partId, line.partId)).orderBy(asc(partReceipts.receivedAt));
        let need = qty;
        for (const layer of layers) {
          if (need <= 0) break;
          if (layer.quantityRemaining <= 0) continue;
          const take = Math.min(need, layer.quantityRemaining);
          await db.update(partReceipts).set({ quantityRemaining: layer.quantityRemaining - take }).where(eq(partReceipts.id, layer.id));
          need -= take;
        }
        await db.update(parts).set({ quantityOnHand: sql`${parts.quantityOnHand} - ${qty}`, updatedAt: new Date() }).where(eq(parts.id, line.partId));
      }
      await db.update(workOrders).set({ partsConsumed: true, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
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
