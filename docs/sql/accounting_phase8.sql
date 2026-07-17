-- ============================================================================
-- Accounting Module — Phase 8: Tax / government tracking
-- Run this in Neon's SQL Editor AFTER accounting_phase1.sql.
-- (This project applies schema changes by hand; we do NOT run drizzle-kit
-- migrate/push — see CLAUDE.md.)
--
-- Tax liability itself is tracked in the ledger (Sales Tax Payable, account
-- 2100, already seeded in Phase 1). This adds only a configurable rate table.
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tax_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction  text NOT NULL,
  rate_pct      numeric(6,3) NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_rates_active_idx ON tax_rates (is_active);
