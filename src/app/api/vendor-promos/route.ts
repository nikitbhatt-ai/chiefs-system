import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createPromo, listPromos, PromoAllocationError } from "@/lib/promos";

// GET /api/vendor-promos — every promo with vendor name + line count.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await listPromos());
}

// POST /api/vendor-promos
//   { vendorId, name, packagePrice, freight?, notes?, lines: [{ sku, quantity }] }
// Snapshots each line's à la carte cost, validates via the allocation engine,
// and stores the promo. 400 with a message on any validation/allocation error.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const promo = await createPromo({
      vendorId: String(body.vendorId ?? ""),
      name: String(body.name ?? ""),
      packagePrice: Number(body.packagePrice),
      freight: body.freight == null || body.freight === "" ? null : Number(body.freight),
      notes: body.notes ?? null,
      lines: Array.isArray(body.lines) ? body.lines : [],
    });
    return NextResponse.json(promo, { status: 201 });
  } catch (e) {
    const status = e instanceof PromoAllocationError ? 422 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
