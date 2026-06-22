import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clockOut } from "@/lib/timeclock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  const result = await clockOut(session.user.id, coords);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
