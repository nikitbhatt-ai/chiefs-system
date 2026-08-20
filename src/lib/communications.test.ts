// Unit tests for the pure parts of communication ingest — address
// normalization, the internal-domain test, and Graph message mapping. No test
// framework is configured in this repo, so this runs standalone under tsx:
//
//   npx tsx src/lib/communications.test.ts
//
// Deliberately covers only the DB-free functions. `resolveTarget` and
// `recordCommunication` need a database and are exercised against Neon.

import assert from "node:assert/strict";
import { isInternalEmail, normalizeEmail, normalizePhone, snippetOf } from "./communications";
import { mapGraphMessage, type GraphMessage } from "./graph";

process.env.INTERNAL_EMAIL_DOMAINS = "chiefspursuitsurplus.com,chiefspursuit.com";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ─── normalizeEmail ──────────────────────────────────────────────────────────

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  Jane.Doe@Example.COM "), "jane.doe@example.com");
});

test("normalizeEmail unwraps a display-name form", () => {
  assert.equal(normalizeEmail('"Doe, Jane" <Jane@Example.com>'), "jane@example.com");
});

test("normalizeEmail rejects anything without an @", () => {
  assert.equal(normalizeEmail("not-an-address"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
});

// ─── normalizePhone ──────────────────────────────────────────────────────────

test("normalizePhone reduces US formats to the same 10 digits", () => {
  const forms = ["(555) 123-4567", "555-123-4567", "+1 555 123 4567", "15551234567"];
  const normalized = new Set(forms.map((f) => normalizePhone(f)));
  assert.equal(normalized.size, 1, "all formats should collapse to one key");
  assert.equal(normalized.has("5551234567"), true);
});

test("normalizePhone rejects fragments too short to identify anyone", () => {
  assert.equal(normalizePhone("1234"), null);
  assert.equal(normalizePhone("ext. 12"), null);
});

// ─── isInternalEmail ─────────────────────────────────────────────────────────

test("isInternalEmail is true for every configured domain", () => {
  assert.equal(isInternalEmail("nikit@chiefspursuitsurplus.com"), true);
  assert.equal(isInternalEmail("SALES@ChiefsPursuit.com"), true);
});

test("isInternalEmail is false for customers", () => {
  assert.equal(isInternalEmail("chief@springfieldpd.gov"), false);
  // A lookalike domain must not read as internal.
  assert.equal(isInternalEmail("someone@notchiefspursuitsurplus.com.example.net"), false);
});

// ─── snippetOf ───────────────────────────────────────────────────────────────

test("snippetOf collapses whitespace and truncates with an ellipsis", () => {
  assert.equal(snippetOf("hello\n\n  world"), "hello world");
  const long = "x".repeat(400);
  const s = snippetOf(long, 280)!;
  assert.equal(s.length, 281, "280 chars plus the ellipsis");
  assert.equal(s.endsWith("…"), true);
});

test("snippetOf returns null for empty input rather than an empty string", () => {
  assert.equal(snippetOf("   "), null);
  assert.equal(snippetOf(null), null);
});

// ─── mapGraphMessage ─────────────────────────────────────────────────────────

const inboundMsg: GraphMessage = {
  id: "AAA",
  internetMessageId: "<abc@springfieldpd.gov>",
  conversationId: "conv-1",
  subject: "Quote for 12 patrol upfits",
  body: { contentType: "text", content: "Can you price 12 units?" },
  bodyPreview: "Can you price 12 units?",
  receivedDateTime: "2026-08-19T15:04:05Z",
  from: { emailAddress: { name: "Chief Boyle", address: "chief@springfieldpd.gov" } },
  toRecipients: [{ emailAddress: { name: "Sales", address: "sales@chiefspursuitsurplus.com" } }],
  ccRecipients: [{ emailAddress: { address: "deputy@springfieldpd.gov" } }],
  hasAttachments: false,
};

test("mapGraphMessage marks mail from outside as inbound", () => {
  const m = mapGraphMessage(inboundMsg, "sales@chiefspursuitsurplus.com", "inbox")!;
  assert.equal(m.direction, "inbound");
  assert.equal(m.channel, "email");
  assert.equal(m.source, "graph");
});

test("mapGraphMessage keys identity on internetMessageId, not the per-mailbox id", () => {
  // Graph gives every mailbox its own `id` for the same message, so using it
  // would store a mail between two synced mailboxes twice.
  const m = mapGraphMessage(inboundMsg, "sales@chiefspursuitsurplus.com", "inbox")!;
  assert.equal(m.externalId, "<abc@springfieldpd.gov>");
});

test("mapGraphMessage falls back to the Graph id when internetMessageId is absent", () => {
  const m = mapGraphMessage({ ...inboundMsg, internetMessageId: undefined }, "sales@chiefspursuitsurplus.com", "inbox")!;
  assert.equal(m.externalId, "graph:AAA");
});

test("mapGraphMessage returns null when there is no usable id at all", () => {
  assert.equal(mapGraphMessage({ id: "" } as GraphMessage, "sales@chiefspursuitsurplus.com", "inbox"), null);
});

test("mapGraphMessage captures every recipient with its role", () => {
  const m = mapGraphMessage(inboundMsg, "sales@chiefspursuitsurplus.com", "inbox")!;
  assert.deepEqual(
    m.participants.map((p) => [p.role, p.email]),
    [
      ["from", "chief@springfieldpd.gov"],
      ["to", "sales@chiefspursuitsurplus.com"],
      ["cc", "deputy@springfieldpd.gov"],
    ],
  );
});

test("mapGraphMessage treats Sent Items as outbound and uses sentDateTime", () => {
  const sent: GraphMessage = {
    ...inboundMsg,
    sentDateTime: "2026-08-20T09:00:00Z",
    from: { emailAddress: { address: "nikit@chiefspursuitsurplus.com" } },
    toRecipients: [{ emailAddress: { address: "chief@springfieldpd.gov" } }],
  };
  const m = mapGraphMessage(sent, "nikit@chiefspursuitsurplus.com", "sentitems")!;
  assert.equal(m.direction, "outbound");
  assert.equal(m.occurredAt?.toISOString(), "2026-08-20T09:00:00.000Z");
});

test("mapGraphMessage marks internal senders outbound even outside Sent Items", () => {
  const m = mapGraphMessage(
    { ...inboundMsg, from: { emailAddress: { address: "nikit@chiefspursuitsurplus.com" } } },
    "sales@chiefspursuitsurplus.com",
    "inbox",
  )!;
  assert.equal(m.direction, "outbound");
});

test("mapGraphMessage keeps the conversation id as the thread key", () => {
  // This is what glues a reply to whatever deal the thread was filed on.
  const m = mapGraphMessage(inboundMsg, "sales@chiefspursuitsurplus.com", "inbox")!;
  assert.equal(m.threadKey, "conv-1");
});

test("mapGraphMessage stores an HTML body as html, not as text", () => {
  const html: GraphMessage = {
    ...inboundMsg,
    body: { contentType: "html", content: "<p>Can you price 12 units?</p>" },
  };
  const m = mapGraphMessage(html, "sales@chiefspursuitsurplus.com", "inbox")!;
  assert.equal(m.bodyHtml, "<p>Can you price 12 units?</p>");
  assert.equal(m.bodyText, "Can you price 12 units?", "falls back to bodyPreview for the text form");
});

console.log(`\n${passed} tests passed`);
