import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { renderRecordPdf } from "@/lib/pdf/registry";
import { logPdfGeneration } from "@/lib/pdf/audit";

export const dynamic = "force-dynamic";
// React-PDF needs the Node runtime; force off Edge.
export const runtime = "nodejs";

// Quote PDF download. ?variant=invoice flips the document title + footer
// wording for converted quotes (no separate invoice table yet — invoices
// are the same record as their source quote).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  const variant = url.searchParams.get("variant") === "invoice" ? "invoice" : "quote";
  const recordType = variant === "invoice" ? "invoice" : "quote";

  const result = await renderRecordPdf(recordType, id);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await logPdfGeneration({
    recordType,
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
