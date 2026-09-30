import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import { quotes, upfitConfigs } from "@/db/schema";
import { renderRecordPdf } from "@/lib/pdf/registry";
import { logPdfGeneration } from "@/lib/pdf/audit";
import { mailerConfigured, parseRecipients, sendMail, type MailAttachment } from "@/lib/mailer";
import { upsertQuoteLink } from "@/lib/customerDocLinks";
import { BRANDING } from "@/lib/pdf/branding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/quotes/[id]/email  { to, subject?, message? }
//
// "Email to Customer": renders the written estimate PDF plus — when the
// estimate has a vehicle configuration — the lighting-layout spec sheet,
// and emails both to the customer. A draft estimate moves to "sent".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  if (!mailerConfigured()) {
    return NextResponse.json(
      { error: "Email isn't set up on this server yet (EMAIL_SERVER_HOST / EMAIL_FROM). Download the PDF and attach it instead." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { to?: unknown; subject?: unknown; message?: unknown };
  const to = parseRecipients(typeof body.to === "string" ? body.to : "");
  if (!to) {
    return NextResponse.json({ error: "Enter a valid email address (up to 5, separated by commas)." }, { status: 400 });
  }

  const [q] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });

  const quotePdf = await renderRecordPdf(q.status === "converted" ? "invoice" : "quote", id);
  if (!quotePdf) return NextResponse.json({ error: "not found" }, { status: 404 });
  const attachments: MailAttachment[] = [
    { filename: quotePdf.fileName, content: quotePdf.buffer, contentType: "application/pdf" },
  ];

  const [config] = await db.select().from(upfitConfigs).where(eq(upfitConfigs.quoteId, id));
  const upfitPdf = config ? await renderRecordPdf("upfit", id) : null;
  if (upfitPdf) {
    attachments.push({ filename: upfitPdf.fileName, content: upfitPdf.buffer, contentType: "application/pdf" });
  }

  const number = q.quoteNumber ?? "your estimate";
  const subject =
    typeof body.subject === "string" && body.subject.trim()
      ? body.subject.trim().slice(0, 200)
      : `Estimate ${number} from ${BRANDING.companyName}`;
  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim().slice(0, 5000)
      : `Please find estimate ${number} attached${upfitPdf ? ", along with the vehicle lighting layout" : ""}.`;

  try {
    await sendMail({
      to,
      subject,
      text: message,
      replyTo: session.user.email ?? BRANDING.email,
      attachments,
    });
  } catch (err) {
    console.error("estimate email failed:", err);
    return NextResponse.json({ error: "The email server rejected the message. Try again, or download the PDF." }, { status: 502 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const recipient = to.join(", ");
  await logPdfGeneration({
    recordType: q.status === "converted" ? "invoice" : "quote",
    recordId: id,
    template: quotePdf.template,
    purpose: "email",
    userId: session.user.id,
    recipient,
    ipAddress: ip,
  });
  if (upfitPdf) {
    await logPdfGeneration({
      recordType: "upfit",
      recordId: id,
      template: upfitPdf.template,
      purpose: "email",
      userId: session.user.id,
      recipient,
      ipAddress: ip,
    });
  }

  // Sending a draft is what makes it "sent".
  let status = q.status;
  if (q.status === "draft") {
    await db.update(quotes).set({ status: "sent", updatedAt: new Date() }).where(eq(quotes.id, id));
    status = "sent";
    try {
      await upsertQuoteLink(id);
    } catch (err) {
      console.error("upsertQuoteLink failed:", err);
    }
    revalidatePath("/quotes");
  }
  revalidatePath(`/quotes/${id}`);

  return NextResponse.json({ ok: true, to, status, attachments: attachments.map((a) => a.filename) });
}
