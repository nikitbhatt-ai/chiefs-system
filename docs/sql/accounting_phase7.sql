-- ============================================================================
-- Accounting Module — Phase 7: AR/AP agents (draft-only)
-- Run this in Neon's SQL Editor AFTER accounting_phase1/2.
-- (This project applies schema changes by hand; we do NOT run drizzle-kit
-- migrate/push — see CLAUDE.md.)
--
-- Also required for the agents to run: set ANTHROPIC_API_KEY in the Vercel
-- project environment. Without it the screens still load and show a clear
-- "not configured" message instead of erroring.
--
-- Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE agent_kind         AS ENUM ('ar_reminder','ap_schedule');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agent_draft_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS agent_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            agent_kind NOT NULL,
  status          agent_draft_status NOT NULL DEFAULT 'pending',
  title           text NOT NULL,
  content         text NOT NULL,
  edited_content  text,
  context         jsonb,
  invoice_id      uuid REFERENCES ar_invoices(id),
  model           text,
  created_by      uuid REFERENCES users(id),
  reviewed_by     uuid REFERENCES users(id),
  reviewed_at     timestamp,
  review_note     text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_drafts_kind_idx   ON agent_drafts (kind);
CREATE INDEX IF NOT EXISTS agent_drafts_status_idx ON agent_drafts (status);
