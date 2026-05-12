import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { renderRecordPdf } from "@/lib/pdf/registry";
import { logPdfGeneration } from "@/lib/pdf/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const result = await renderRecordPdf("purchase_order", id);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logPdfGeneration({
    recordType: "purchase_order",
    recordId: id,
    template: result.template,
    purpose: "download",
    userId: session.user.id,
    ipAddress: ip,
  });

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
