// Microsoft Graph — app-only mail sync.
//
// App-only (client-credentials) rather than delegated OAuth on purpose: the
// sync has to run unattended on a cron with nobody signed in, and a delegated
// refresh token that quietly lapses would stop one rep's mail from syncing
// without anyone noticing. One app credential, admin-consented once, scoped in
// Exchange to just the mailboxes in `comm_accounts`.
//
// Setup (see docs/REQUIREMENTS.md § Communication ingest for the full walk-through):
//   1. Entra ID → App registrations → new registration.
//   2. API permissions → Microsoft Graph → *Application* permissions →
//      Mail.Read (and User.Read.All to resolve addresses → object ids).
//      Grant admin consent.
//   3. Exchange Online PowerShell → New-ApplicationAccessPolicy, scoping the
//      app to a mail-enabled security group holding only the sales mailboxes.
//      Without this the credential can read every mailbox in the tenant.
//   4. Set GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET on Vercel.

import { snippetOf, type CommunicationInput, type ParticipantInput } from "@/lib/communications";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Folders we sync. Sent Items is what makes the timeline two-sided — without
// it you only ever see what customers said to us.
export const SYNCED_FOLDERS = ["inbox", "sentitems"] as const;
export type SyncedFolder = (typeof SYNCED_FOLDERS)[number];

export function graphConfigured(): boolean {
  return !!(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET
  );
}

export class GraphError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Graph request failed (${status}): ${body.slice(0, 400)}`);
    this.name = "GraphError";
    this.status = status;
    this.body = body;
  }
}

// Tokens last an hour. Cached at module scope so a warm serverless instance
// reuses one across accounts and folders instead of re-authenticating per call.
let tokenCache: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;

  const tenant = process.env.GRAPH_TENANT_ID;
  if (!graphConfigured()) throw new Error("Graph is not configured (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)");

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID!,
      client_secret: process.env.GRAPH_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) throw new GraphError(res.status, text, "Could not obtain a Graph token");

  const json = JSON.parse(text) as { access_token: string; expires_in: number };
  tokenCache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

// One authenticated GET, with a bounded retry on Graph's throttling response.
// Everything else surfaces as a GraphError so the sync can record it on the
// account row rather than failing silently.
async function graphGet(url: string, opts: { textBody?: boolean } = {}): Promise<Record<string, unknown>> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const token = await accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    // Ask Exchange to convert bodies to plain text server-side. Saves storing
    // megabytes of quoted HTML and makes the timeline readable as-is.
    if (opts.textBody) headers.prefer = 'outlook.body-content-type="text"';

    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.ok) return (await res.json()) as Record<string, unknown>;

    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxAttempts) throw new GraphError(res.status, body);

    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 500 * 2 ** (attempt - 1);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error("unreachable");
}

// ─────────────────────────────────────────────────────────────────────────────
// Message shape (only the fields we $select)
// ─────────────────────────────────────────────────────────────────────────────

type GraphAddress = { name?: string; address?: string };
type GraphRecipient = { emailAddress?: GraphAddress };

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  receivedDateTime?: string;
  sentDateTime?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  hasAttachments?: boolean;
  isDraft?: boolean;
  webLink?: string;
  "@removed"?: { reason?: string };
};

const MESSAGE_SELECT = [
  "id",
  "internetMessageId",
  "conversationId",
  "subject",
  "bodyPreview",
  "body",
  "receivedDateTime",
  "sentDateTime",
  "from",
  "sender",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "hasAttachments",
  "isDraft",
  "webLink",
].join(",");

const PAGE_SIZE = 50;

// Address → Entra object id. Stored on the account so later syncs don't depend
// on the address staying the same (aliases and renames happen).
export async function resolveGraphUserId(address: string): Promise<string> {
  const json = await graphGet(`${GRAPH_BASE}/users/${encodeURIComponent(address)}?$select=id`);
  const id = json.id;
  if (typeof id !== "string") throw new Error(`Graph returned no object id for ${address}`);
  return id;
}

function messagesUrl(graphUserId: string, folder: SyncedFolder, suffix: string): string {
  return `${GRAPH_BASE}/users/${encodeURIComponent(graphUserId)}/mailFolders/${folder}/messages${suffix}`;
}

// A deltaLink representing "the mailbox as it is right now", without
// enumerating its history. Used to start incremental sync after the bounded
// backfill, so a first run never drags in years of mail.
export async function fetchLatestDeltaLink(graphUserId: string, folder: SyncedFolder): Promise<string | null> {
  const json = await graphGet(messagesUrl(graphUserId, folder, `/delta?$deltatoken=latest&$select=${MESSAGE_SELECT}`));
  const link = json["@odata.deltaLink"];
  return typeof link === "string" ? link : null;
}

// Bounded initial backfill: recent messages only, newest first.
export async function fetchMessagesSince(
  graphUserId: string,
  folder: SyncedFolder,
  since: Date,
  maxPages = 4,
): Promise<GraphMessage[]> {
  const dateField = folder === "sentitems" ? "sentDateTime" : "receivedDateTime";
  let url: string | null = messagesUrl(
    graphUserId,
    folder,
    `?$select=${MESSAGE_SELECT}&$top=${PAGE_SIZE}` +
      `&$filter=${dateField} ge ${since.toISOString()}` +
      `&$orderby=${dateField} desc`,
  );

  const out: GraphMessage[] = [];
  for (let page = 0; page < maxPages && url; page++) {
    const json = await graphGet(url, { textBody: true });
    out.push(...((json.value as GraphMessage[] | undefined) ?? []));
    const next = json["@odata.nextLink"];
    url = typeof next === "string" ? next : null;
  }
  return out;
}

// Incremental sync. Returns the messages changed since the stored cursor plus
// the next cursor to persist.
export async function fetchDelta(
  deltaLink: string,
  maxPages = 8,
): Promise<{ messages: GraphMessage[]; deltaLink: string | null }> {
  let url: string | null = deltaLink;
  const messages: GraphMessage[] = [];
  let nextDelta: string | null = null;

  for (let page = 0; page < maxPages && url; page++) {
    const json = await graphGet(url, { textBody: true });
    messages.push(...((json.value as GraphMessage[] | undefined) ?? []));

    const next = json["@odata.nextLink"];
    const delta = json["@odata.deltaLink"];
    if (typeof delta === "string") {
      nextDelta = delta;
      url = null;
    } else {
      url = typeof next === "string" ? next : null;
    }
  }

  // No deltaLink yet means more pages remain than maxPages allowed; keep the
  // nextLink as the cursor so the following run resumes where this one stopped.
  return { messages, deltaLink: nextDelta ?? url };
}

// Attachment metadata only — names and sizes, not bytes. Enough to see "we
// sent them the quote PDF" on the timeline; pulling bytes into Blob storage is
// a follow-up. Failures are swallowed by the caller: a missing attachment list
// must not cost us the message.
export async function fetchAttachmentMeta(
  graphUserId: string,
  messageId: string,
): Promise<{ filename: string; mimeType: string | null; sizeBytes: number | null; externalId: string | null }[]> {
  const json = await graphGet(
    `${GRAPH_BASE}/users/${encodeURIComponent(graphUserId)}/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size`,
  );
  const rows = (json.value as { id?: string; name?: string; contentType?: string; size?: number }[] | undefined) ?? [];
  return rows.map((a) => ({
    filename: a.name ?? "attachment",
    mimeType: a.contentType ?? null,
    sizeBytes: typeof a.size === "number" ? a.size : null,
    externalId: a.id ?? null,
  }));
}

function participantsOf(msg: GraphMessage): ParticipantInput[] {
  const out: ParticipantInput[] = [];
  const push = (role: ParticipantInput["role"], r: GraphRecipient | undefined) => {
    const address = r?.emailAddress?.address;
    if (!address) return;
    out.push({ role, email: address, name: r?.emailAddress?.name ?? null });
  };
  push("from", msg.from ?? msg.sender);
  for (const r of msg.toRecipients ?? []) push("to", r);
  for (const r of msg.ccRecipients ?? []) push("cc", r);
  for (const r of msg.bccRecipients ?? []) push("bcc", r);
  return out;
}

// Graph message → the shape `recordCommunication` wants. No I/O and no
// attribution logic: the matcher owns that.
export function mapGraphMessage(
  msg: GraphMessage,
  mailboxAddress: string,
  folder: SyncedFolder,
): CommunicationInput | null {
  // internetMessageId is the cross-mailbox identity of a message — using it
  // (not Graph's per-mailbox `id`) means a mail between two synced mailboxes
  // is stored once, not twice.
  const externalId = msg.internetMessageId ?? (msg.id ? `graph:${msg.id}` : null);
  if (!externalId) return null;

  const participants = participantsOf(msg);
  const fromAddress = (msg.from ?? msg.sender)?.emailAddress?.address ?? null;

  // Sent Items is outbound by definition; elsewhere the sender decides.
  const internal = fromAddress
    ? (process.env.INTERNAL_EMAIL_DOMAINS ?? "chiefspursuitsurplus.com")
        .split(",")
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .includes(fromAddress.split("@")[1]?.toLowerCase() ?? "")
    : false;
  const direction = folder === "sentitems" || internal ? "outbound" : "inbound";

  const occurredAtRaw = folder === "sentitems" ? msg.sentDateTime : msg.receivedDateTime;
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();

  // With Prefer: outlook.body-content-type="text" the body is already plain
  // text; bodyPreview is the fallback when a body wasn't returned.
  const isText = (msg.body?.contentType ?? "").toLowerCase() !== "html";
  const bodyText = isText ? (msg.body?.content ?? msg.bodyPreview ?? null) : (msg.bodyPreview ?? null);

  return {
    channel: "email",
    direction,
    source: "graph",
    subject: msg.subject ?? null,
    bodyText,
    bodyHtml: isText ? null : (msg.body?.content ?? null),
    externalId,
    threadKey: msg.conversationId ?? null,
    occurredAt,
    mailboxAddress,
    participants,
    metadata: {
      graphMessageId: msg.id,
      folder,
      webLink: msg.webLink ?? null,
      hasAttachments: !!msg.hasAttachments,
      snippet: snippetOf(msg.bodyPreview),
    },
  };
}
