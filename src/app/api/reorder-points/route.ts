import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setReorderPoint } from "@/lib/backfill";

// POST /api/reorder-points  { partId, minQty, reorderToQty }
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.partId) return NextResponse.json({ error: "partId is required" }, { status: 400 });
  try {
    await setReorderPoint({
      partId: String(body.partId),
      minQty: Number(body.minQty ?? 0),
      reorderToQty: Number(body.reorderToQty ?? 0),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
