-- Communications — Phase 1: channel-agnostic communication timeline.
--
-- Run in Neon's SQL Editor. Safe to re-run (IF NOT EXISTS throughout; the
-- backfill at the bottom is guarded on external_id so a second run is a
-- no-op).
--
-- Schema mirrors src/db/schema.ts :: customerContacts, communications,
-- communicationParticipants, communicationAttachments, commAccounts,
-- commSyncState.
--
-- Supersedes customer_messages. That table is NOT dropped — its rows are
-- copied into communications and the old table is left in place read-only in
-- case anything needs to be reconciled later.

-- ─────────────────────────────────────────────────────────────────────────────
-- Contacts: every address/number we know for a customer. Matching keys off
-- this, so a fleet manager who isn't the billing contact still resolves.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         text,
  title        text,
  email        text,
  phone        text,
  is_primary   boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_contacts_customer_idx ON customer_contacts (customer_id);
CREATE INDEX IF NOT EXISTS customer_contacts_email_idx    ON customer_contacts (email);
CREATE INDEX IF NOT EXISTS customer_contacts_phone_idx    ON customer_contacts (phone);

-- ─────────────────────────────────────────────────────────────────────────────
-- The timeline itself.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          text NOT NULL,                     -- email|call|sms|meeting|in_person|note|other
  direction        text NOT NULL,                     -- inbound|outbound|internal
  status           text NOT NULL DEFAULT 'matched',   -- matched|unassigned|ignored
  source           text NOT NULL DEFAULT 'manual',    -- manual|graph|dropbox|telephony
  matched_by       text,                              -- thread|contact|lead|mailbox|manual
  lead_id          uuid REFERENCES leads(id)     ON DELETE SET NULL,
  customer_id      uuid REFERENCES customers(id) ON DELETE SET NULL,
  deal_id          uuid REFERENCES deals(id)     ON DELETE SET NULL,
  subject          text,
  body_text        text,
  body_html        text,
  snippet          text,
  external_id      text,
  thread_key       text,
  occurred_at      timestamp NOT NULL DEFAULT now(),
  duration_seconds integer,
  recording_url    text,
  transcript       text,
  mailbox_address  text,
  sent_by          uuid REFERENCES users(id),
  assigned_by      uuid REFERENCES users(id),
  assigned_at      timestamp,
  metadata         jsonb,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

-- Idempotent ingest: the provider's own id is unique. Postgres allows
-- repeated NULLs, so manually logged rows (no external id) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS communications_external_id_idx ON communications (external_id);
CREATE INDEX IF NOT EXISTS communications_deal_idx     ON communications (deal_id);
CREATE INDEX IF NOT EXISTS communications_customer_idx ON communications (customer_id);
CREATE INDEX IF NOT EXISTS communications_lead_idx     ON communications (lead_id);
CREATE INDEX IF NOT EXISTS communications_thread_idx   ON communications (thread_key);
CREATE INDEX IF NOT EXISTS communications_status_idx   ON communications (status);
CREATE INDEX IF NOT EXISTS communications_occurred_idx ON communications (occurred_at);

CREATE TABLE IF NOT EXISTS communication_participants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  communication_id    uuid NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  role                text NOT NULL,                  -- from|to|cc|bcc|caller|callee
  name                text,
  email               text,
  phone               text,
  is_internal         boolean NOT NULL DEFAULT false,
  customer_contact_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communication_participants_comm_idx  ON communication_participants (communication_id);
CREATE INDEX IF NOT EXISTS communication_participants_email_idx ON communication_participants (email);

CREATE TABLE IF NOT EXISTS communication_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  communication_id uuid NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  filename         text NOT NULL,
  mime_type        text,
  size_bytes       bigint,
  blob_url         text,
  external_id      text,
  created_at       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communication_attachments_comm_idx ON communication_attachments (communication_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sync plumbing. A mailbox absent from comm_accounts is never read, even
-- though the Graph app credential could technically reach it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comm_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL DEFAULT 'mailbox',   -- mailbox|phone_line
  address        text NOT NULL UNIQUE,
  label          text,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  provider       text NOT NULL DEFAULT 'graph',
  graph_user_id  text,
  active         boolean NOT NULL DEFAULT true,
  sync_enabled   boolean NOT NULL DEFAULT true,
  last_synced_at timestamp,
  last_error     text,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comm_sync_state (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES comm_accounts(id) ON DELETE CASCADE,
  folder         text NOT NULL,                     -- 'inbox' | 'sentitems'
  delta_link     text,
  last_run_at    timestamp,
  last_error     text,
  last_ingested  integer,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS comm_sync_state_account_folder_idx
  ON comm_sync_state (account_id, folder);

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: seed customer_contacts from the single customers.email column, so
-- the matcher has something to work with on day one.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO customer_contacts (customer_id, name, email, is_primary)
SELECT c.id, c.name, lower(trim(c.email)), true
FROM customers c
WHERE c.email IS NOT NULL
  AND trim(c.email) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM customer_contacts cc
    WHERE cc.customer_id = c.id
      AND cc.email = lower(trim(c.email))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: copy the manual customer_messages log into communications.
-- external_id is stamped 'legacy:<old id>' so this is idempotent and the
-- provenance of every migrated row stays visible.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO communications (
  channel, direction, status, source, matched_by,
  deal_id, customer_id, subject, body_text, snippet,
  external_id, occurred_at, sent_by, metadata, created_at
)
SELECT
  cm.channel,
  cm.direction,
  'matched',
  'manual',
  'manual',
  cm.deal_id,
  d.customer_id,
  cm.subject,
  cm.body,
  left(coalesce(cm.body, ''), 280),
  'legacy:' || cm.id::text,
  cm.created_at,
  cm.sent_by,
  cm.metadata,
  cm.created_at
FROM customer_messages cm
LEFT JOIN deals d ON d.id = cm.deal_id
WHERE NOT EXISTS (
  SELECT 1 FROM communications x WHERE x.external_id = 'legacy:' || cm.id::text
);
