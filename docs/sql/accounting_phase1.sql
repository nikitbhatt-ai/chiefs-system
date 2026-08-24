-- ============================================================================
-- Accounting Module — Phase 1: Core double-entry ledger
-- Run this in Neon's SQL Editor (the project applies schema changes by hand;
-- we do NOT run drizzle-kit migrate/push — see CLAUDE.md).
--
-- Safe to run more than once: every statement is guarded with IF NOT EXISTS /
-- ON CONFLICT DO NOTHING, and the trigger functions are CREATE OR REPLACE.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE gl_account_type   AS ENUM ('asset','liability','equity','revenue','expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE gl_report_group   AS ENUM ('revenue','labor','other_expense','none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE gl_normal_balance AS ENUM ('debit','credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE journal_source    AS ENUM ('manual','ar','ap','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE journal_status    AS ENUM ('draft','posted','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gl_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  type           gl_account_type NOT NULL,
  report_group   gl_report_group NOT NULL DEFAULT 'none',
  normal_balance gl_normal_balance NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gl_accounts_type_idx ON gl_accounts (type);

CREATE TABLE IF NOT EXISTS journal_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date         timestamp NOT NULL DEFAULT now(),
  memo               text,
  source             journal_source NOT NULL DEFAULT 'manual',
  status             journal_status NOT NULL DEFAULT 'draft',
  reverses_entry_id  uuid REFERENCES journal_entries(id),
  created_by         uuid REFERENCES users(id),
  posted_at          timestamp,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_entries_status_idx ON journal_entries (status);
CREATE INDEX IF NOT EXISTS journal_entries_date_idx   ON journal_entries (entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES gl_accounts(id),
  debit_cents       bigint NOT NULL DEFAULT 0,
  credit_cents      bigint NOT NULL DEFAULT 0,
  department_id     uuid REFERENCES departments(id),
  work_order_id     uuid REFERENCES work_orders(id),
  memo              text,
  created_at        timestamp NOT NULL DEFAULT now(),
  -- A line is EITHER a debit or a credit, never both, never negative.
  CONSTRAINT journal_lines_debit_xor_credit
    CHECK (debit_cents >= 0 AND credit_cents >= 0 AND (debit_cents = 0) <> (credit_cents = 0))
);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx      ON journal_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx    ON journal_lines (account_id);
CREATE INDEX IF NOT EXISTS journal_lines_department_idx ON journal_lines (department_id);
CREATE INDEX IF NOT EXISTS journal_lines_work_order_idx ON journal_lines (work_order_id);

-- ── Rule #2: debits must equal credits to POST.  Rule #3: posted = immutable ──
-- Fires on the journal_entries row. Posting (status -> 'posted') requires the
-- lines to balance and be non-empty; once posted, the entry can never change.
CREATE OR REPLACE FUNCTION journal_entries_guard() RETURNS trigger AS $$
DECLARE
  total_debit  bigint;
  total_credit bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable; create a reversing entry instead.';
  END IF;

  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status <> 'posted') THEN
    SELECT COALESCE(SUM(debit_cents),0), COALESCE(SUM(credit_cents),0)
      INTO total_debit, total_credit
      FROM journal_lines WHERE journal_entry_id = NEW.id;

    IF total_debit = 0 AND total_credit = 0 THEN
      RAISE EXCEPTION 'Cannot post an empty journal entry (no lines / zero amounts).';
    END IF;
    IF total_debit <> total_credit THEN
      RAISE EXCEPTION 'Unbalanced journal entry: debits % <> credits % (cents).',
        total_debit, total_credit;
    END IF;

    IF NEW.posted_at IS NULL THEN
      NEW.posted_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_guard_trg ON journal_entries;
CREATE TRIGGER journal_entries_guard_trg
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_guard();

CREATE OR REPLACE FUNCTION journal_entries_no_delete_posted() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Cannot delete a posted journal entry; reverse it instead.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_no_delete_posted_trg ON journal_entries;
CREATE TRIGGER journal_entries_no_delete_posted_trg
  BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_no_delete_posted();

-- Lines of a posted entry cannot be inserted, edited, or removed.
CREATE OR REPLACE FUNCTION journal_lines_guard() RETURNS trigger AS $$
DECLARE
  v_status journal_status;
  v_entry  uuid;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT status INTO v_status FROM journal_entries WHERE id = v_entry;
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Cannot modify lines of a posted journal entry.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_guard_trg ON journal_lines;
CREATE TRIGGER journal_lines_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_guard();

-- ── Seed: the five departments ───────────────────────────────────────────────
INSERT INTO departments (code, name) VALUES
  ('admin',     'Admin'),
  ('upfitting', 'Upfitting'),
  ('mechanics', 'Mechanics'),
  ('body_shop', 'Body Shop'),
  ('general',   'General')
ON CONFLICT (code) DO NOTHING;

-- ── Seed: starter chart of accounts (tagged with report_group for the P&L) ────
INSERT INTO gl_accounts (code, name, type, report_group, normal_balance) VALUES
  -- Assets (balance sheet — no report group)
  ('1000', 'Cash',                  'asset',     'none', 'debit'),
  ('1100', 'Accounts Receivable',   'asset',     'none', 'debit'),
  ('1200', 'Inventory',             'asset',     'none', 'debit'),
  ('1300', 'Work in Progress',      'asset',     'none', 'debit'),
  -- Liabilities
  ('2000', 'Accounts Payable',      'liability', 'none', 'credit'),
  -- Goods received but not yet invoiced. Receiving credits this; the vendor
  -- bill relieves it and credits 2000. Keeps a PO receipt and its bill from
  -- both crediting Accounts Payable. See accounting_phase10.sql.
  ('2050', 'Accrued Purchases (GRNI)', 'liability', 'none', 'credit'),
  ('2100', 'Sales Tax Payable',     'liability', 'none', 'credit'),
  -- Equity
  ('3000', 'Owner''s Equity',       'equity',    'none', 'credit'),
  ('3900', 'Retained Earnings',     'equity',    'none', 'credit'),
  -- Revenue
  ('4000', 'Sales Revenue',         'revenue',   'revenue', 'credit'),
  -- Labor (expense, grouped under Labor on the P&L)
  ('5000', 'Wages',                 'expense',   'labor', 'debit'),
  ('5010', 'Payroll Taxes',         'expense',   'labor', 'debit'),
  ('5020', 'Benefits',              'expense',   'labor', 'debit'),
  ('5030', 'Contractor Labor',      'expense',   'labor', 'debit'),
  -- Cost of goods sold + other operating expenses
  ('5100', 'Cost of Goods Sold',    'expense',   'other_expense', 'debit'),
  -- Vendor billed more than was received against the PO; the difference lands
  -- here so it is visible rather than silently absorbed.
  ('5900', 'Purchase Price Variance', 'expense',  'other_expense', 'debit'),
  ('6000', 'Rent',                  'expense',   'other_expense', 'debit'),
  ('6010', 'Utilities',             'expense',   'other_expense', 'debit'),
  ('6020', 'Software',              'expense',   'other_expense', 'debit'),
  ('6030', 'Supplies',              'expense',   'other_expense', 'debit'),
  ('6040', 'Insurance',             'expense',   'other_expense', 'debit'),
  ('6050', 'Office Expense',        'expense',   'other_expense', 'debit')
ON CONFLICT (code) DO NOTHING;
