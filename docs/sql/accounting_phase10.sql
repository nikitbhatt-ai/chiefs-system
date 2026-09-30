-- ============================================================================
-- Accounting Module — Phase 10: fix the PO receipt / vendor bill double-count
-- Run this in Neon's SQL Editor. Safe to run more than once.
--
-- THE BUG THIS FIXES
-- Receiving goods and being billed for them are two events for ONE liability,
-- but both credited Accounts Payable (2000):
--
--   Receive parts   Dr Inventory 1200 / Cr Accounts Payable 2000
--   Vendor bill     Dr <expense>      / Cr Accounts Payable 2000
--
-- So a $10,000 PO that was received AND billed showed $20,000 owed, and the
-- cost was recorded twice — once as an Inventory asset, once as an expense.
--
-- THE FIX
-- Receipt credits a clearing account instead, and the bill relieves it:
--
--   Receive parts   Dr Inventory 1200        / Cr Accrued Purchases 2050
--   Vendor bill     Dr Accrued Purchases 2050 / Cr Accounts Payable 2000
--                   Dr Purchase Price Variance 5900  (only if the bill exceeds
--                                                     what was received)
--   Pay vendor      Dr Accounts Payable 2000 / Cr Cash 1000   (unchanged)
--
-- Over the full cycle Inventory goes up, Cash goes down, and 2050 returns to
-- zero. Its running balance is a useful figure in its own right: the value of
-- goods received but not yet invoiced.
--
-- ⚠️  THIS SQL ONLY ADDS THE ACCOUNTS. It does not correct history. Entries
-- already posted still double-credit 2000 — see "Sizing what is already
-- posted" in docs/REQUIREMENTS.md for the query, and have whoever signs off on
-- the books decide between reclassifying and reversing before posting the
-- correcting entry.
-- ============================================================================

INSERT INTO gl_accounts (code, name, type, report_group, normal_balance) VALUES
  -- Goods received, not yet invoiced. Sits between receipt and vendor bill.
  ('2050', 'Accrued Purchases (GRNI)', 'liability', 'none',          'credit'),
  -- Where a vendor billing more than was received lands, so the difference is
  -- visible on the P&L instead of being silently absorbed.
  ('5900', 'Purchase Price Variance',  'expense',   'other_expense', 'debit')
ON CONFLICT (code) DO NOTHING;

-- Confirm both exist (expect two rows):
--   SELECT code, name, type, normal_balance FROM gl_accounts
--    WHERE code IN ('2050','5900') ORDER BY code;
