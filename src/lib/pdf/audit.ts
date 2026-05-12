import { db } from "@/db";
import { pdfAuditLog } from "@/db/schema";

export type PdfAuditPurpose = "download" | "email" | "auto_generated" | "bulk_export";

export async function logPdfGeneration(opts: {
  recordType: string;
  recordId: string;
  template: string;
  purpose: PdfAuditPurpose;
  userId?: string | null;
  recipient?: string | null;
  ipAddress?: string | null;
}) {
  await db.insert(pdfAuditLog).values({
    recordType: opts.recordType,
    recordId: opts.recordId,
    template: opts.template,
    purpose: opts.purpose,
    userId: opts.userId ?? null,
    recipient: opts.recipient ?? null,
    ipAddress: opts.ipAddress ?? null,
  });
}
