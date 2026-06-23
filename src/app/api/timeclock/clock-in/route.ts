import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clockIn } from "@/lib/timeclock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const workOrderId = body?.workOrderId ? String(body.workOrderId) : null;

  const result = await clockIn(session.user.id, workOrderId, coords);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, distanceMeters: result.distanceMeters, radiusMeters: result.radiusMeters },
      { status: result.status },
    );
  }
  return NextResponse.json(result);
}
