import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ vin: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { vin } = await params;
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length < 11) {
    return NextResponse.json({ error: "VIN too short" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(cleanVin)}?format=json`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "VIN service error" }, { status: 502 });
    }
    const data = await res.json();
    const result = data?.Results?.[0] ?? {};
    return NextResponse.json({
      vin: cleanVin,
      year: result.ModelYear ? Number(result.ModelYear) : null,
      make: result.Make || null,
      model: result.Model || null,
      trim: result.Trim || null,
      bodyClass: result.BodyClass || null,
      fuelType: result.FuelTypePrimary || null,
      raw: result,
    });
  } catch (e) {
    return NextResponse.json({ error: "VIN lookup failed" }, { status: 500 });
  }
}
