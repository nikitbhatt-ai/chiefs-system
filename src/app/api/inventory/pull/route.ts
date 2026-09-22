import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pullStock } from "@/lib/inventory";
import { checkReordersForParts } from "@/lib/backfill";

export const dynamic = "force-dynamic";

// POST /api/inventory/pull — scan-pull / scan-return (see pullStock).
// Body: { mode: "pull" | "return", workOrderId?, reason?, note?,
//         items: [{ partId, qty }] }
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "items are required" }, { status: 400 });
  }
  const mode = body.mode === "return" ? "return" : "pull";
  const result = await pullStock({
    mode,
    workOrderId: typeof body.workOrderId === "string" && body.workOrderId ? body.workOrderId : null,
    reason: typeof body.reason === "string" ? body.reason : null,
    note: typeof body.note === "string" ? body.note : null,
    userId: session.user.id ?? null,
    items: body.items,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Pulling dropped on-hand — raise reorder-point backfills where a part hit
  // its threshold. Best-effort: bookkeeping must never fail the pull.
  if (mode === "pull") {
    try {
      await checkReordersForParts(result.results.map((r) => r.partId));
    } catch (err) {
      console.error("checkReordersForParts failed:", err);
    }
  }
  return NextResponse.json(result);
}
