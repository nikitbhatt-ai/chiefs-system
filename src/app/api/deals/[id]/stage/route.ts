import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canOverrideStageGate } from "@/lib/rbac";
import { applyDealStageChange } from "@/lib/dealStage";

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
  if (body?.override === true && !canOverrideStageGate(session)) {
    return NextResponse.json({ error: "Only managers can override stage gates." }, { status: 403 });
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
