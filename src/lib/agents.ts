// AR/AP agents — Phase 7.
//
// These make server-side Claude calls that DRAFT content only — they never send
// an email, move money, or touch an external system. Every result is written to
// `agent_drafts` as `pending`; a human then Approves, Edits, or Rejects it, and
// that decision is logged. "Approve" is an internal sign-off, not an external
// action — sending the email or scheduling the payment stays a manual step.

import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts, arInvoices, customers } from "@/db/schema";
import { fmtCents } from "@/lib/accounting";
import { paidCentsForInvoice } from "@/lib/ar";
import { apAging } from "@/lib/reports";
import { fmtDate } from "@/lib/datetime";

const MODEL = "claude-opus-4-8";

/** Surfaced to the UI as a friendly message (missing key, empty draft, etc.). */
export class AgentError extends Error {}

function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AgentError(
      "The AR/AP agents aren't configured yet — set ANTHROPIC_API_KEY in the Vercel project environment to enable them.",
    );
  }
  return new Anthropic({ apiKey });
}

/** Whether the agents can run at all (key present). Pages use this to show a hint. */
export function agentsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type GenerateOpts = { system: string; prompt: string; maxTokens?: number; think?: boolean };

async function generate({ system, prompt, maxTokens = 6000, think = false }: GenerateOpts): Promise<string> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // Adaptive thinking only where the task benefits (AP analysis); off for a
    // simple email so the draft comes back fast.
    ...(think ? { thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const } } : {}),
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new AgentError("The agent returned an empty draft — please try again.");
  return text;
}

// ── AR: overdue-invoice reminder email ────────────────────────────────────────

const AR_SYSTEM = `You are an accounts-receivable assistant for Chiefs Pursuit Surplus, a vehicle upfitting company. Draft a professional payment-reminder email to a customer about an overdue invoice.

Rules:
- Tone: courteous and professional, firmer the more overdue the balance is, but never threatening.
- Use ONLY the facts provided. Do not invent payment links, portals, late fees, legal consequences, or contact details that weren't given.
- Do not promise anything on the company's behalf beyond a request for payment.
- Output the email and nothing else: a "Subject:" line, then a blank line, then the body. Sign off as "Chiefs Pursuit Surplus — Accounts Receivable".`;

export async function draftArReminder(invoiceId: string, createdBy?: string | null) {
  const invoice = await db.query.arInvoices.findFirst({ where: eq(arInvoices.id, invoiceId) });
  if (!invoice) throw new AgentError("Invoice not found.");
  const customer = invoice.customerId
    ? await db.query.customers.findFirst({ where: eq(customers.id, invoice.customerId) })
    : null;

  const paidCents = await paidCentsForInvoice(invoiceId);
  const balanceCents = invoice.totalCents - paidCents;
  if (balanceCents <= 0) throw new AgentError("This invoice is already paid — nothing to remind about.");
  const daysOverdue = Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000);

  const facts = [
    `Customer: ${customer?.name ?? "Valued customer"}`,
    `Invoice number: ${invoice.invoiceNumber}`,
    `Invoice date: ${fmtDate(invoice.invoiceDate)}`,
    `Due date: ${fmtDate(invoice.dueDate)}`,
    `Original amount: ${fmtCents(invoice.totalCents)}`,
    `Amount already paid: ${fmtCents(paidCents)}`,
    `Balance now due: ${fmtCents(balanceCents)}`,
    daysOverdue > 0 ? `Days past due: ${daysOverdue}` : `Status: due now (not yet past due)`,
  ].join("\n");

  const content = await generate({
    system: AR_SYSTEM,
    prompt: `Draft a reminder email for this invoice:\n\n${facts}`,
    maxTokens: 1500,
  });

  const [draft] = await db
    .insert(agentDrafts)
    .values({
      kind: "ar_reminder",
      status: "pending",
      title: `Reminder — ${invoice.invoiceNumber}${customer?.name ? ` · ${customer.name}` : ""}`,
      content,
      context: { invoiceNumber: invoice.invoiceNumber, balanceCents, daysOverdue, customer: customer?.name ?? null },
      invoiceId,
      model: MODEL,
      createdBy: createdBy ?? null,
    })
    .returning();
  return draft;
}

// ── AP: payment schedule + anomaly flags ──────────────────────────────────────

const AP_SYSTEM = `You are an accounts-payable assistant for Chiefs Pursuit Surplus. You are given the company's currently OPEN vendor bills. Produce two things in Markdown:

1. "Flags" — anything worth a human's attention: bills already past due, unusually large balances relative to the others, possible duplicates (same vendor + very close amounts), or clusters due in the same short window.
2. "Proposed payment schedule" — a prioritized plan grouped by urgency (e.g. Pay now / This week / Later), listing bill number, vendor, amount, and due date, with a one-line rationale per group.

Rules:
- Use ONLY the bills provided. Do not assume how much cash is available and do not state that anything has been paid or scheduled — you are RECOMMENDING for a human to approve.
- Be concise. End with a one-line reminder that a person must review and execute payments.`;

export async function draftApSchedule(createdBy?: string | null) {
  const aging = await apAging();
  if (aging.rows.length === 0) throw new AgentError("There are no open bills to plan.");

  const lines = aging.rows
    .map((r) => `- ${r.number} | vendor: ${r.party} | balance: ${fmtCents(r.balanceCents)} | due: ${fmtDate(r.dueDate)} | bucket: ${r.bucket}`)
    .join("\n");
  const summary = `Total open payables: ${fmtCents(aging.grandTotal)} across ${aging.rows.length} bill(s). As of ${fmtDate(new Date())}.`;

  const content = await generate({
    system: AP_SYSTEM,
    prompt: `${summary}\n\nOpen bills:\n${lines}`,
    maxTokens: 6000,
    think: true,
  });

  const [draft] = await db
    .insert(agentDrafts)
    .values({
      kind: "ap_schedule",
      status: "pending",
      title: `Payables plan — ${fmtDate(new Date())}`,
      content,
      context: { totalCents: aging.grandTotal, billCount: aging.rows.length },
      model: MODEL,
      createdBy: createdBy ?? null,
    })
    .returning();
  return draft;
}

// ── Review: approve / edit / reject (all logged) ──────────────────────────────

export async function saveDraftEdit(id: string, editedContent: string) {
  await db
    .update(agentDrafts)
    .set({ editedContent, updatedAt: new Date() })
    .where(eq(agentDrafts.id, id));
}

export async function approveDraft(id: string, reviewedBy?: string | null, note?: string | null) {
  await db
    .update(agentDrafts)
    .set({ status: "approved", reviewedBy: reviewedBy ?? null, reviewedAt: new Date(), reviewNote: note ?? null, updatedAt: new Date() })
    .where(eq(agentDrafts.id, id));
}

export async function rejectDraft(id: string, reviewedBy?: string | null, note?: string | null) {
  await db
    .update(agentDrafts)
    .set({ status: "rejected", reviewedBy: reviewedBy ?? null, reviewedAt: new Date(), reviewNote: note ?? null, updatedAt: new Date() })
    .where(eq(agentDrafts.id, id));
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function listDrafts() {
  return db.select().from(agentDrafts).orderBy(desc(agentDrafts.createdAt)).limit(100);
}

/** Overdue open invoices that don't already have a pending reminder draft. */
export async function overdueInvoicesNeedingReminder() {
  const now = new Date();
  const rows = await db
    .select({
      id: arInvoices.id,
      invoiceNumber: arInvoices.invoiceNumber,
      customerName: customers.name,
      dueDate: arInvoices.dueDate,
      totalCents: arInvoices.totalCents,
      paidCents: sql<number>`COALESCE((SELECT SUM(r.amount_cents) FROM receipts r WHERE r.invoice_id = ${arInvoices.id}), 0)`.mapWith(Number),
      pendingDraft: sql<number>`COALESCE((SELECT count(*) FROM agent_drafts d WHERE d.invoice_id = ${arInvoices.id} AND d.status = 'pending'), 0)`.mapWith(Number),
    })
    .from(arInvoices)
    .leftJoin(customers, eq(customers.id, arInvoices.customerId))
    .where(and(eq(arInvoices.status, "open"), sql`${arInvoices.dueDate} < ${now}`))
    .orderBy(asc(arInvoices.dueDate));

  return rows
    .map((r) => ({ ...r, balanceCents: r.totalCents - r.paidCents }))
    .filter((r) => r.balanceCents > 0 && r.pendingDraft === 0);
}
