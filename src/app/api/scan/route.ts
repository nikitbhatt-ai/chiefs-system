import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { lookupScan, normalizeScan } from "@/lib/scan";

export const dynamic = "force-dynamic";

// GET /api/scan?code=… — resolve a scanned barcode to parts (barcode, SKU,
// mfg part #) and vehicles (VIN). Exact matches only; see src/lib/scan.ts.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const code = normalizeScan(url.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const hits = await lookupScan(code);
  return NextResponse.json({ code, hits });
}
