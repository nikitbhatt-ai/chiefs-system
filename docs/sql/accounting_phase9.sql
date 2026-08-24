-- ============================================================================
-- Accounting Module — Phase 9: QuickBooks Online integration
-- Run this in Neon's SQL Editor AFTER accounting_phase1.sql.
-- (This project applies schema changes by hand; we do NOT run drizzle-kit
-- migrate/push — see CLAUDE.md.)
--
-- ALSO required to actually connect (the screens work without these, but stay
-- inert and say "not configured"): set these in the Vercel project env —
--   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI
-- and register the redirect URI in your Intuit developer app.
--
-- Safe to run more than once.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE qbo_environment AS ENUM ('sandbox','production');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS qbo_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment       qbo_environment NOT NULL DEFAULT 'sandbox',
  realm_id          text,
  access_token      text,
  refresh_token     text,
  token_expires_at  timestamp,
  connected_at      timestamp,
  auth_state        text,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbo_account_map (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gl_account_id    uuid NOT NULL UNIQUE REFERENCES gl_accounts(id) ON DELETE CASCADE,
  qbo_account_id   text,
  qbo_account_name text,
  updated_at       timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qbo_account_map_gl_idx ON qbo_account_map (gl_account_id);

CREATE TABLE IF NOT EXISTS qbo_sync_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text NOT NULL,
  direction   text,
  status      text NOT NULL,
  message     text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qbo_sync_log_created_idx ON qbo_sync_log (created_at);
