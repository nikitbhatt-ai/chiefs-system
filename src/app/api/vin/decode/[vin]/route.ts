import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { decodeVin } from "@/lib/vin";

// Thin wrapper over the shared decoder in `@/lib/vin`, which is the single
// NHTSA vPIC integration in the system. Kept because the quote editor and the
// add-vehicle form call it from the browser; server code should import
// decodeVin directly rather than round-trip through here.
export async function GET(_req: Request, { params }: { params: Promise<{ vin: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { vin } = await params;
  const cleanVin = vin.trim().toUpperCase();

  // Deliberately looser than the 17-character rule used by the check-in flow:
  // vPIC decodes partial VINs, and these callers rely on that.
  if (cleanVin.length < 11) {
    return NextResponse.json({ error: "VIN too short" }, { status: 400 });
  }

  const result = await decodeVin(cleanVin);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result.data);
}
