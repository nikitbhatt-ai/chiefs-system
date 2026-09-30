import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildPackagePOLines, PromoAllocationError } from "@/lib/promos";

// GET /api/vendor-promos/[id]/po-lines
// Runs the allocation engine once and returns { vendorId, lines } ready to drop
// onto a purchase order — allocated unit cost + source_promo_id stamped per line.
// This is how "picking a promo on the PO fills in its lines" works; allocation
// happens here, at PO-build time, never at receipt.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const result = await buildPackagePOLines(id);
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof PromoAllocationError ? 422 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
