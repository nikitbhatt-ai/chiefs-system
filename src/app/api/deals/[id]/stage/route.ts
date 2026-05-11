import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, dealCredentials, customerDocuments } from "@/db/schema";
import { canAdvanceTo, type DealStage } from "@/lib/pipelines";
import { isCredentialActive } from "@/lib/credentials";
import { docForPipeline } from "@/lib/documentTemplates";
import { maybePromoteWonDeal } from "@/lib/dealTriggers";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const targetStage = String(body?.stage ?? "");
  if (!targetStage) return NextResponse.json({ error: "Missing stage" }, { status: 400 });

  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  if (!d) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (targetStage === d.stage) return NextResponse.json({ ok: true, stage: d.stage });

  const creds = await db
    .select({ verifiedAt: dealCredentials.verifiedAt, expiresAt: dealCredentials.expiresAt })
    .from(dealCredentials)
    .where(eq(dealCredentials.dealId, id));
  const hasActiveCredential = creds.some((c) => isCredentialActive(c));

  const docSpec = docForPipeline(d.pipeline);
  let hasPipelineDocument = true;
  if (docSpec) {
    const docRows = await db
      .select({ id: customerDocuments.id })
      .from(customerDocuments)
      .where(and(
        eq(customerDocuments.associatedDealId, id),
        eq(customerDocuments.kind, docSpec.slug),
        eq(customerDocuments.isCurrentVersion, true),
      ))
      .limit(1);
    hasPipelineDocument = docRows.length > 0;
  }

  const transition = canAdvanceTo(d.pipeline, d.stage, targetStage, {
    hasActiveCredential,
    hasPipelineDocument,
    pipelineDocumentRequiredBeforeStage: docSpec?.requiredBeforeStage,
    pipelineDocumentLabel: docSpec?.label,
  });
  if (!transition.ok) return NextResponse.json({ error: transition.reason }, { status: 400 });

  await db
    .update(deals)
    .set({ stage: targetStage as DealStage, currentStageEnteredAt: new Date(), updatedAt: new Date() })
    .where(eq(deals.id, id));

  const promotion = await maybePromoteWonDeal(id, targetStage, d.stage);

  return NextResponse.json({
    ok: true,
    stage: targetStage,
    promotedQuoteId: promotion.ok ? promotion.promotedQuoteId : null,
    createdWorkOrderId: promotion.ok ? promotion.createdWorkOrderId : null,
  });
}
