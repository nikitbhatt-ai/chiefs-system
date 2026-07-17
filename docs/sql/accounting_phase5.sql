-- ============================================================================
-- Accounting Module — Phase 5: Job costing
-- Run this in Neon's SQL Editor AFTER accounting_phase1.sql.
-- (This project applies schema changes by hand; we do NOT run drizzle-kit
-- migrate/push — see CLAUDE.md.)
--
-- Safe to run more than once.
-- ============================================================================

-- Settlement latch: which journal entry moved a job's WIP to COGS (NULL = open).
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS cogs_journal_entry_id uuid REFERENCES journal_entries(id);

-- Hourly labor cost rates. One row per user; a row with user_id IS NULL is the
-- shop-wide default used when a user has no override.
CREATE TABLE IF NOT EXISTS labor_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  rate_cents  bigint NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);
-- One rate per user (and one default). Postgres treats NULLs as distinct, so the
-- single-default rule is also enforced in app code.
CREATE UNIQUE INDEX IF NOT EXISTS labor_rates_user_uidx ON labor_rates (user_id);
