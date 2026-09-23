-- ============================================================================
-- Purchase-order fees (shipping / handling / customs …)
-- Run this in Neon's SQL Editor (the project applies schema changes by hand;
-- we do NOT run drizzle-kit migrate/push — see CLAUDE.md).
--
-- Safe to run more than once: every statement is guarded with IF NOT EXISTS /
-- ON CONFLICT DO NOTHING.
--
-- Needs: accounting_phase1.sql (gl_accounts) and accounting_phase11.sql (the
-- 'cogs' account type + 'cogs_parts' report group). If those haven't been run,
-- the two ALTERs below still apply and fees work in the UI; only the ledger
-- posting is skipped until the chart of accounts exists.
-- ============================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────
-- fees: [{ id, description, amount, kind: 'freight' | 'other' }]
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS fees jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Non-freight fees already accrued to the ledger, in integer cents. Doubles as
-- the post-once latch and as the extra GRNI accrual a vendor bill must relieve.
-- Freight is NOT counted here — it is capitalized into the receipt layers, so
-- part_receipts already carries it.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS fees_accrued_cents integer NOT NULL DEFAULT 0;

-- ── Chart of accounts: where non-freight purchase fees are expensed ──────────
-- Freight does NOT post here: it is capitalized into Inventory (1200) via the
-- received parts' landed cost, and becomes COGS when those parts are consumed.
-- 5210 Freight In therefore stays for freight billed separately of a PO.
INSERT INTO gl_accounts (code, name, type, report_group, normal_balance) VALUES
  ('5230', 'Purchase Fees & Surcharges', 'cogs', 'cogs_parts', 'debit')
ON CONFLICT (code) DO NOTHING;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'purchase_orders' AND column_name IN ('fees','fees_accrued_cents');
-- SELECT code, name, type, report_group FROM gl_accounts WHERE code = '5230';
