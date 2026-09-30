import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { renderRecordPdf } from "@/lib/pdf/registry";
import { logPdfGeneration } from "@/lib/pdf/audit";

export const dynamic = "force-dynamic";
// React-PDF needs the Node runtime; force off Edge.
export const runtime = "nodejs";

// The work-order build sheet (de-priced), keyed on the ESTIMATE instead of the
// work order. Same template and same source line items as
// /api/pdf/work-orders/[id] — this exists so sales can pull the build sheet from
// the quote without hunting for the work order, and so the button still works
// before a work order exists (one is only created when the deal reaches Won /
// confirmed).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { quoteId } = await params;

  const result = await renderRecordPdf("work_order_from_quote", quoteId);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logPdfGeneration({
    recordType: "work_order",
    recordId: quoteId,
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
