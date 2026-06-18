import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { renderRecordPdf } from "@/lib/pdf/registry";
import { logPdfGeneration } from "@/lib/pdf/audit";

export const dynamic = "force-dynamic";
// React-PDF needs the Node runtime; force off Edge.
export const runtime = "nodejs";

// Work-order build sheet (de-priced). Same source line items as the
// estimate/invoice, with all pricing removed — only part name, brand,
// manufacturer part number, and quantity.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const result = await renderRecordPdf("work_order", id);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logPdfGeneration({
    recordType: "work_order",
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
      "Content-Disposition": `inline; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
