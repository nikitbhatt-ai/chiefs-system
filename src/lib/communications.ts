// Communication ingest + attribution.
//
// Every channel writes through this module: the manual log on the deal page,
// the Microsoft Graph mail sync, and (later) telephony. Adapters do provider
// I/O and hand `recordCommunication` a normalized shape; everything about
// *where a message belongs* is decided here, once.
//
// Attribution order (strongest signal first):
//   1. thread   — we've filed this conversation before; inherit its target.
//   2. contact  — an external participant matches customer_contacts.
//   3. lead     — an external participant matches leads.email.
//   4. none     — status 'unassigned', lands in the /communications triage
//                 queue for a human to file.
//
// Anything a human files is stamped matched_by='manual' and is never
// re-decided by the matcher.

import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  communications,
  communicationParticipants,
  communicationAttachments,
  customerContacts,
  deals,
  leads,
} from "@/db/schema";

// Addresses on these domains are us, not a customer. A thread whose every
// participant is internal is never ingested — that's colleagues talking, not
// sales activity.
export function internalDomains(): string[] {
  const raw = process.env.INTERNAL_EMAIL_DOMAINS ?? "chiefspursuitsurplus.com";
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

// 'known_contacts' (default) — only ingest mail where an external participant
//   already matches a customer contact or a lead. Nothing else is stored.
// 'all_external'  — ingest anything with an external participant; unmatched
//   messages land in triage.
export type IngestScope = "known_contacts" | "all_external";

export function ingestScope(): IngestScope {
  return process.env.COMM_INGEST_SCOPE === "all_external" ? "all_external" : "known_contacts";
}

// Deal stages that mean "done" — excluded when picking which open deal a
// message belongs to.
const CLOSED_STAGES: (typeof deals.$inferSelect)["stage"][] = ["delivered", "lost"];

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  // Tolerate "Display Name <addr@example.com>" as well as a bare address.
  const angle = value.match(/<([^>]+)>/);
  const raw = (angle ? angle[1] : value).trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

// Compared on the last 10 digits so "(555) 123-4567", "555-123-4567" and
// "+15551234567" all match the same contact.
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

export function isInternalEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const domain = normalized.split("@")[1] ?? "";
  return internalDomains().includes(domain);
}

export function snippetOf(body: string | null | undefined, limit = 280): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export type ParticipantRole = "from" | "to" | "cc" | "bcc" | "caller" | "callee";

export type ParticipantInput = {
  role: ParticipantRole;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type AttachmentInput = {
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  blobUrl?: string | null;
  externalId?: string | null;
};

export type CommunicationTarget = {
  leadId?: string | null;
  customerId?: string | null;
  dealId?: string | null;
};

export type CommunicationInput = {
  channel: string;
  direction: string;
  source: string;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  externalId?: string | null;
  threadKey?: string | null;
  occurredAt?: Date | null;
  mailboxAddress?: string | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  transcript?: string | null;
  metadata?: unknown;
  sentBy?: string | null;
  participants: ParticipantInput[];
  attachments?: AttachmentInput[];
  // Set by the manual log and by triage assignment. Skips the matcher.
  target?: CommunicationTarget | null;
};

export type ResolvedTarget = CommunicationTarget & {
  status: "matched" | "unassigned";
  matchedBy: string | null;
  // Participant rows the matcher was able to tie to a customer contact, so
  // recordCommunication can persist the link without re-querying.
  contactIdByEmail: Map<string, string>;
};

function externalEmails(participants: ParticipantInput[]): string[] {
  const set = new Set<string>();
  for (const p of participants) {
    const email = normalizeEmail(p.email);
    if (email && !isInternalEmail(email)) set.add(email);
  }
  return Array.from(set);
}

// Resolve which lead/customer/deal a message belongs to. Pure lookup — no
// writes — so it can also power a "where would this land?" preview.
export async function resolveTarget(input: CommunicationInput): Promise<ResolvedTarget> {
  const contactIdByEmail = new Map<string, string>();

  // A human already told us where this goes.
  if (input.target && (input.target.leadId || input.target.customerId || input.target.dealId)) {
    return {
      leadId: input.target.leadId ?? null,
      customerId: input.target.customerId ?? null,
      dealId: input.target.dealId ?? null,
      status: "matched",
      matchedBy: "manual",
      contactIdByEmail,
    };
  }

  const emails = externalEmails(input.participants);

  // Contact lookup runs regardless of how the target is decided — the
  // participant rows want the contact link even when the thread supplied the
  // deal.
  let contactRows: { id: string; customerId: string; email: string | null }[] = [];
  if (emails.length > 0) {
    contactRows = await db
      .select({ id: customerContacts.id, customerId: customerContacts.customerId, email: customerContacts.email })
      .from(customerContacts)
      .where(and(eq(customerContacts.active, true), inArray(customerContacts.email, emails)));
    for (const row of contactRows) {
      if (row.email) contactIdByEmail.set(row.email, row.id);
    }
  }

  // 1. Thread — a reply belongs wherever the conversation was already filed.
  if (input.threadKey) {
    const [prior] = await db
      .select({
        leadId: communications.leadId,
        customerId: communications.customerId,
        dealId: communications.dealId,
      })
      .from(communications)
      .where(and(eq(communications.threadKey, input.threadKey), eq(communications.status, "matched")))
      .orderBy(desc(communications.occurredAt))
      .limit(1);
    if (prior && (prior.leadId || prior.customerId || prior.dealId)) {
      return { ...prior, status: "matched", matchedBy: "thread", contactIdByEmail };
    }
  }

  // 2. Contact — resolve to the customer, then to a single open deal if there
  //    is exactly one. With several open deals we file at the account level
  //    rather than guessing; the deal timeline surfaces account-level rows too.
  if (contactRows.length > 0) {
    const customerId = contactRows[0].customerId;
    const openDeals = await db
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          eq(deals.customerId, customerId),
          eq(deals.archived, false),
          notInArray(deals.stage, CLOSED_STAGES),
        ),
      )
      .orderBy(desc(deals.updatedAt))
      .limit(2);
    return {
      leadId: null,
      customerId,
      dealId: openDeals.length === 1 ? openDeals[0].id : null,
      status: "matched",
      matchedBy: "contact",
      contactIdByEmail,
    };
  }

  // 3. Lead — a prospect who isn't a customer yet. If the lead has already
  //    been converted, follow it through to the customer/deal it became.
  if (emails.length > 0) {
    const [leadRow] = await db
      .select({
        id: leads.id,
        convertedCustomerId: leads.convertedCustomerId,
        convertedDealId: leads.convertedDealId,
      })
      .from(leads)
      .where(and(eq(leads.archived, false), isNotNull(leads.email), inArray(sql`lower(${leads.email})`, emails)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (leadRow) {
      return {
        leadId: leadRow.id,
        customerId: leadRow.convertedCustomerId ?? null,
        dealId: leadRow.convertedDealId ?? null,
        status: "matched",
        matchedBy: "lead",
        contactIdByEmail,
      };
    }
  }

  // 4. Nothing matched.
  return { leadId: null, customerId: null, dealId: null, status: "unassigned", matchedBy: null, contactIdByEmail };
}

// Scope gate. Returns null when the message should be ingested, or a reason
// string when it should be skipped (logged by the sync for visibility).
export function scopeSkipReason(input: CommunicationInput, resolved: ResolvedTarget): string | null {
  const hasExternal = externalEmails(input.participants).length > 0;
  const hasPhoneParticipant = input.participants.some((p) => normalizePhone(p.phone));
  if (!hasExternal && !hasPhoneParticipant) return "internal_only";
  if (ingestScope() === "known_contacts" && resolved.status === "unassigned") return "unknown_contact";
  return null;
}

export type RecordResult =
  | { ok: true; id: string; created: boolean; status: string; matchedBy: string | null }
  | { ok: false; skipped: string };

// Idempotent write. `external_id` is UNIQUE, so re-syncing a mailbox or
// replaying a webhook can't duplicate a row — the insert simply reports
// created:false.
export async function recordCommunication(input: CommunicationInput): Promise<RecordResult> {
  const resolved = await resolveTarget(input);

  // Manual logs and human triage assignments bypass the scope gate; it only
  // governs automated ingest.
  if (input.source !== "manual") {
    const skip = scopeSkipReason(input, resolved);
    if (skip) return { ok: false, skipped: skip };
  }

  const bodyText = input.bodyText ?? null;

  const inserted = await db
    .insert(communications)
    .values({
      channel: input.channel,
      direction: input.direction,
      status: resolved.status,
      source: input.source,
      matchedBy: resolved.matchedBy,
      leadId: resolved.leadId ?? null,
      customerId: resolved.customerId ?? null,
      dealId: resolved.dealId ?? null,
      subject: input.subject ?? null,
      bodyText,
      bodyHtml: input.bodyHtml ?? null,
      snippet: snippetOf(bodyText ?? input.subject),
      externalId: input.externalId ?? null,
      threadKey: input.threadKey ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      durationSeconds: input.durationSeconds ?? null,
      recordingUrl: input.recordingUrl ?? null,
      transcript: input.transcript ?? null,
      mailboxAddress: input.mailboxAddress ? input.mailboxAddress.toLowerCase() : null,
      sentBy: input.sentBy ?? null,
      metadata: input.metadata ?? null,
    })
    .onConflictDoNothing({ target: communications.externalId })
    .returning({ id: communications.id });

  // Empty means the unique index rejected it: we already have this message.
  if (inserted.length === 0) {
    return { ok: true, id: "", created: false, status: resolved.status, matchedBy: resolved.matchedBy };
  }

  const communicationId = inserted[0].id;

  if (input.participants.length > 0) {
    await db.insert(communicationParticipants).values(
      input.participants.map((p) => {
        const email = normalizeEmail(p.email);
        return {
          communicationId,
          role: p.role,
          name: p.name ?? null,
          email,
          phone: p.phone ?? null,
          isInternal: isInternalEmail(email),
          customerContactId: (email && resolved.contactIdByEmail.get(email)) ?? null,
        };
      }),
    );
  }

  if (input.attachments && input.attachments.length > 0) {
    await db.insert(communicationAttachments).values(
      input.attachments.map((a) => ({
        communicationId,
        filename: a.filename,
        mimeType: a.mimeType ?? null,
        sizeBytes: a.sizeBytes ?? null,
        blobUrl: a.blobUrl ?? null,
        externalId: a.externalId ?? null,
      })),
    );
  }

  return { ok: true, id: communicationId, created: true, status: resolved.status, matchedBy: resolved.matchedBy };
}

// Triage: file an unassigned message (or re-file a mis-matched one). Also
// teaches the matcher the sender's address by writing a customer contact, so
// the same thread never needs filing twice.
export async function assignCommunication(
  id: string,
  target: CommunicationTarget & { status?: "matched" | "ignored" },
  userId: string | null,
): Promise<boolean> {
  const status = target.status ?? "matched";

  // Only rewrite the target when one was actually supplied. Ignoring a
  // message that was already filed must not blank out where it was filed to.
  const retarget = !!(target.leadId || target.customerId || target.dealId);
  const patch = {
    status,
    matchedBy: "manual",
    assignedBy: userId,
    assignedAt: new Date(),
    updatedAt: new Date(),
    ...(retarget
      ? {
          leadId: target.leadId ?? null,
          customerId: target.customerId ?? null,
          dealId: target.dealId ?? null,
        }
      : {}),
  };

  const [row] = await db
    .update(communications)
    .set(patch)
    .where(eq(communications.id, id))
    .returning({ id: communications.id, customerId: communications.customerId });

  if (!row) return false;

  // Learn the external senders as contacts on the customer we just filed to.
  if (status === "matched" && row.customerId) {
    await learnContacts(id, row.customerId);
  }
  return true;
}

// Persist any external participant of `communicationId` that isn't already a
// contact on `customerId`. This is what makes triage a one-time cost per
// address instead of a recurring chore.
export async function learnContacts(communicationId: string, customerId: string): Promise<number> {
  const participants = await db
    .select({ name: communicationParticipants.name, email: communicationParticipants.email })
    .from(communicationParticipants)
    .where(
      and(
        eq(communicationParticipants.communicationId, communicationId),
        eq(communicationParticipants.isInternal, false),
        isNotNull(communicationParticipants.email),
      ),
    );

  const emails = Array.from(
    new Set(participants.map((p) => normalizeEmail(p.email)).filter((e): e is string => !!e)),
  );
  if (emails.length === 0) return 0;

  const existing = await db
    .select({ email: customerContacts.email })
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), inArray(customerContacts.email, emails)));
  const known = new Set(existing.map((e) => e.email));

  const toAdd = emails.filter((e) => !known.has(e));
  if (toAdd.length === 0) return 0;

  await db.insert(customerContacts).values(
    toAdd.map((email) => ({
      customerId,
      email,
      name: participants.find((p) => normalizeEmail(p.email) === email)?.name ?? null,
      notes: "Learned from triaged communication",
    })),
  );
  return toAdd.length;
}

// Which of these provider ids we already have. The delta feed re-sends a
// message whenever anything about it changes (including being marked read), so
// filtering known ids up front skips both the matcher and the per-message
// attachment fetch for rows that would only be discarded on insert.
export async function existingExternalIds(ids: string[]): Promise<Set<string>> {
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return new Set();
  const rows = await db
    .select({ externalId: communications.externalId })
    .from(communications)
    .where(inArray(communications.externalId, wanted));
  return new Set(rows.map((r) => r.externalId).filter((v): v is string => !!v));
}
