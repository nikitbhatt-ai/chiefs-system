import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { importPackageTemplates } from "@/lib/packageTemplateImport";

// POST /api/package-templates/import  { csv, vendorId, commit? }
// Preview (commit=false) or import a vendor package-template CSV: à la carte
// prices + one allocated vendor_promo (when the sheet has a package price) + a
// sellable package. See src/lib/packageTemplateImport.ts.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.csv !== "string") {
    return NextResponse.json({ error: "expected JSON { csv, vendorId, commit? }" }, { status: 400 });
  }

  const { error, response } = await importPackageTemplates({
    csv: body.csv,
    vendorId: String(body.vendorId ?? ""),
    commit: body.commit === true,
  });
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json(response);
}
