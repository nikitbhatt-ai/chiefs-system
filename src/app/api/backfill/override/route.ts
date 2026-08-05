import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { overridePull } from "@/lib/backfill";

// POST /api/backfill/override  { partId, qty, reason, workOrderId? }
// Pulls reserved stock — logs who/why and raises a self-tracking backfill.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.partId || !body?.qty || !body?.reason) {
    return NextResponse.json({ error: "partId, qty and reason are required" }, { status: 400 });
  }
  try {
    const result = await overridePull({
      partId: String(body.partId),
      qty: Number(body.qty),
      reason: String(body.reason),
      workOrderId: body.workOrderId ? String(body.workOrderId) : null,
      userId: session.user.id ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
