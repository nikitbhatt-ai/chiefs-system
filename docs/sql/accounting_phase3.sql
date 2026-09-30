-- ============================================================================
-- Accounting Module — Phase 3: Accounts Payable
-- Run this in Neon's SQL Editor AFTER accounting_phase1.sql (and phase2).
-- (This project applies schema changes by hand; we do NOT run drizzle-kit
-- migrate/push — see CLAUDE.md.)
--
-- Safe to run more than once: guarded with IF NOT EXISTS / duplicate_object.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE bill_status    AS ENUM ('open','paid','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('check','ach','card','cash','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Bills (a vendor invoice we owe) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number           text NOT NULL UNIQUE,
  vendor_id             uuid NOT NULL REFERENCES vendors(id),
  vendor_invoice_number text,
  purchase_order_id     uuid REFERENCES purchase_orders(id),
  bill_date             timestamp NOT NULL DEFAULT now(),
  due_date              timestamp NOT NULL,
  terms                 text NOT NULL DEFAULT 'net_30',
  total_cents           bigint NOT NULL DEFAULT 0,
  status                bill_status NOT NULL DEFAULT 'open',
  journal_entry_id      uuid REFERENCES journal_entries(id),
  memo                  text,
  created_by            uuid REFERENCES users(id),
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bills_status_idx ON bills (status);
CREATE INDEX IF NOT EXISTS bills_vendor_idx ON bills (vendor_id);
CREATE INDEX IF NOT EXISTS bills_due_idx    ON bills (due_date);

-- ── Bill lines (each posts to a chosen expense/asset account) ─────────────────
CREATE TABLE IF NOT EXISTS bill_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id       uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES gl_accounts(id),
  description   text,
  amount_cents  bigint NOT NULL DEFAULT 0,
  department_id uuid REFERENCES departments(id),
  work_order_id uuid REFERENCES work_orders(id),
  created_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bill_lines_bill_idx    ON bill_lines (bill_id);
CREATE INDEX IF NOT EXISTS bill_lines_account_idx ON bill_lines (account_id);

-- ── Payments (cash out; optionally applied to one bill) ───────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number    text NOT NULL UNIQUE,
  vendor_id         uuid NOT NULL REFERENCES vendors(id),
  bill_id           uuid REFERENCES bills(id),
  payment_date      timestamp NOT NULL DEFAULT now(),
  method            payment_method NOT NULL DEFAULT 'check',
  reference         text,
  amount_cents      bigint NOT NULL DEFAULT 0,
  memo              text,
  journal_entry_id  uuid REFERENCES journal_entries(id),
  created_by        uuid REFERENCES users(id),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_vendor_idx ON payments (vendor_id);
CREATE INDEX IF NOT EXISTS payments_bill_idx   ON payments (bill_id);
CREATE INDEX IF NOT EXISTS payments_date_idx   ON payments (payment_date);
