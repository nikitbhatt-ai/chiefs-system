-- ============================================================================
-- Accounting Module — Phase 2: Accounts Receivable
-- Run this in Neon's SQL Editor AFTER accounting_phase1.sql.
-- (This project applies schema changes by hand; we do NOT run drizzle-kit
-- migrate/push — see CLAUDE.md.)
--
-- Safe to run more than once: every statement is guarded with IF NOT EXISTS /
-- DO $$ ... duplicate_object.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ar_invoice_status AS ENUM ('open','paid','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE receipt_method    AS ENUM ('cash','check','card','ach','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Invoices (thin AR posting record on top of an existing quote) ─────────────
-- One invoice per quote (quote_id UNIQUE). Totals are snapshotted at issue time
-- so editing the quote afterwards never mutates a posted invoice.
CREATE TABLE IF NOT EXISTS ar_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    text NOT NULL UNIQUE,
  quote_id          uuid NOT NULL UNIQUE REFERENCES quotes(id),
  customer_id       uuid REFERENCES customers(id),
  invoice_date      timestamp NOT NULL DEFAULT now(),
  due_date          timestamp NOT NULL,
  terms             text NOT NULL DEFAULT 'net_30',
  subtotal_cents    bigint NOT NULL DEFAULT 0,
  tax_cents         bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  status            ar_invoice_status NOT NULL DEFAULT 'open',
  journal_entry_id  uuid REFERENCES journal_entries(id),
  memo              text,
  created_by        uuid REFERENCES users(id),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ar_invoices_status_idx   ON ar_invoices (status);
CREATE INDEX IF NOT EXISTS ar_invoices_customer_idx ON ar_invoices (customer_id);
CREATE INDEX IF NOT EXISTS ar_invoices_due_idx      ON ar_invoices (due_date);

-- ── Receipts (cash received; optionally applied to one invoice) ───────────────
CREATE TABLE IF NOT EXISTS receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    text NOT NULL UNIQUE,
  customer_id       uuid REFERENCES customers(id),
  invoice_id        uuid REFERENCES ar_invoices(id),
  receipt_date      timestamp NOT NULL DEFAULT now(),
  method            receipt_method NOT NULL DEFAULT 'check',
  reference         text,
  amount_cents      bigint NOT NULL DEFAULT 0,
  memo              text,
  journal_entry_id  uuid REFERENCES journal_entries(id),
  created_by        uuid REFERENCES users(id),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_customer_idx ON receipts (customer_id);
CREATE INDEX IF NOT EXISTS receipts_invoice_idx  ON receipts (invoice_id);
CREATE INDEX IF NOT EXISTS receipts_date_idx     ON receipts (receipt_date);
