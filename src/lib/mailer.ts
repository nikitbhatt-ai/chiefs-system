// Outgoing email for customer documents (estimates, spec sheets).
//
// Reuses the SMTP settings the sign-in magic link already uses
// (EMAIL_SERVER_HOST / _PORT / _USER / _PASSWORD, EMAIL_FROM), so no new
// configuration is needed. When those aren't set, `mailerConfigured()` is
// false and callers should tell the user instead of failing silently.

import nodemailer from "nodemailer";

export function mailerConfigured(): boolean {
  return !!process.env.EMAIL_SERVER_HOST && !!process.env.EMAIL_FROM;
}

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };

export async function sendMail(opts: {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string | null;
  attachments?: MailAttachment[];
}) {
  const port = Number(process.env.EMAIL_SERVER_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port,
    secure: port === 465,
    auth: process.env.EMAIL_SERVER_USER
      ? { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: opts.to.join(", "),
    replyTo: opts.replyTo ?? undefined,
    subject: opts.subject,
    text: opts.text,
    attachments: opts.attachments,
  });
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

// Split "a@x.com, b@y.com" into a clean list. Returns null if any entry
// is malformed so the caller can show one clear error.
export function parseRecipients(raw: string, max = 5): string[] | null {
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0 || list.length > max) return null;
  return list.every((e) => EMAIL_RE.test(e)) ? list : null;
}
