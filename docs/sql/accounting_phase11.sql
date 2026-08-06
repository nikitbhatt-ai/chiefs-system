-- ============================================================================
-- Accounting Module — Phase 11: chart of accounts restructure
-- Run this in Neon's SQL Editor AFTER accounting_phase10.sql.
-- Safe to run more than once.
--
-- Requested by the accountant:
--   1. Cost of Goods Sold becomes its OWN account type, not an expense
--      subgroup, so it gets its own P&L section above Gross Profit.
--   2. COGS split into the components actually installed on police vehicles
--      (wire, lights, sirens, consoles, partitions, gun locks, brackets,
--      radios, cameras, graphics, freight, job shop supplies).
--   3. Contractor labor moves under COGS.
--   4. Direct labor separated from administrative payroll.
--   5. Operating expenses expanded (6xxx).
--   6. Normal balance is derived from account type, never chosen by hand —
--      enforced in app code (src/lib/chartOfAccounts.ts) and by the CHECK
--      constraint at the bottom of this file.
--
-- ⚠️  ORDERING MATTERS AND IS NOT COSMETIC.
-- Journal lines reference account IDs, not codes, so RENAMING and RENUMBERING
-- are safe — history follows the row. REPURPOSING a code is not: 6010 is
-- currently Utilities and the new chart wants it for Payroll. This script
-- therefore moves the three existing 6xxx accounts to their new codes FIRST,
-- and only then inserts the new 60xx accounts. Run the statements in order; do
-- not cherry-pick.
-- ============================================================================

-- ── 1. Extend the enums ──────────────────────────────────────────────────────
-- COGS as a first-class type. NOTE: src/lib/reports.ts must handle it in the
-- balance sheet or COGS silently drops out of net income and the sheet stops
-- balancing — that is done in the same change as this SQL.
ALTER TYPE gl_account_type ADD VALUE IF NOT EXISTS 'cogs';

-- Finer P&L grouping. The old 'labor' and 'other_expense' values are left in
-- place (Postgres cannot drop enum values) but are no longer assigned.
ALTER TYPE gl_report_group ADD VALUE IF NOT EXISTS 'cogs_parts';
ALTER TYPE gl_report_group ADD VALUE IF NOT EXISTS 'cogs_labor';
-- COGS that is not a component and not direct labor — purchase price variance
-- today. Kept out of 'cogs_parts' because job costing treats that group as
-- "material settled out of WIP" and splits it by part category.
ALTER TYPE gl_report_group ADD VALUE IF NOT EXISTS 'cogs_other';
ALTER TYPE gl_report_group ADD VALUE IF NOT EXISTS 'admin_labor';
ALTER TYPE gl_report_group ADD VALUE IF NOT EXISTS 'operating_expense';

COMMIT;

-- ── 2. Renumber the existing 6xxx accounts BEFORE their codes are reused ─────
-- Renumbering keeps each account's id, so all posted history follows it. If these
-- ran after step 5, past utility bills would end up labelled Payroll and the new
-- Benefits account would silently not be created (ON CONFLICT DO NOTHING) because
-- 6030 was already taken.
--
-- Every renumbering is guarded by "and the destination doesn't exist yet". That
-- guard is what makes re-running this file safe: on a second run 6010 is the NEW
-- Payroll account, and an unguarded `code = '6110' WHERE code = '6010'` would
-- either collide with Utilities or rename Payroll into it. Without the guard the
-- second run does real damage, so do not remove it.
--
-- Where the old account maps onto exactly one new account, it is renumbered into
-- it — no duplicate, history intact:
UPDATE gl_accounts SET code = '6100', name = 'Office Rent',            report_group = 'operating_expense'
 WHERE code = '6000' AND NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.code = '6100');
UPDATE gl_accounts SET code = '6110', name = 'Utilities',              report_group = 'operating_expense'
 WHERE code = '6010' AND NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.code = '6110');
UPDATE gl_accounts SET code = '6120', name = 'Software Subscriptions', report_group = 'operating_expense'
 WHERE code = '6020' AND NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.code = '6120');
UPDATE gl_accounts SET code = '6130', name = 'Insurance',              report_group = 'operating_expense'
 WHERE code = '6040' AND NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.code = '6130');

-- The starter chart's 'Supplies' and 'Office Expense' do NOT map cleanly: the new
-- chart separates office supplies (6140) from shop supplies used off-job (6170),
-- and nothing in the data says which of those the old lumps were. Renaming one
-- into the other would relabel history on a guess, so they are moved out of the
-- way and retired instead — their posted amounts stay exactly where they are, and
-- new spending goes to the precise accounts. If you know what they actually held,
-- reactivate and rename one rather than letting both collect.
UPDATE gl_accounts SET code = '6230', name = 'Supplies — legacy (pre-split)',       is_active = false, report_group = 'operating_expense'
 WHERE code = '6030' AND NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.code = '6230');
UPDATE gl_accounts SET code = '6240', name = 'Office Expense — legacy (pre-split)', is_active = false, report_group = 'operating_expense'
 WHERE code = '6050' AND NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.code = '6240');

-- ── 3. Retire the pre-split payroll accounts ─────────────────────────────────
-- Wages/taxes/benefits held direct and administrative pay mixed together and
-- nothing in the data separates them, so their history stays in operating
-- expenses — splitting it after the fact would restate prior-period gross margin
-- on a guess. Contractor labor is the exception: it was always a cost of the
-- build, so it moves to cogs_labor. That IS a reclassification of prior periods,
-- and it is the correction the accountant asked for.
--
-- All four are marked inactive so they stop appearing in pickers; 5300 and 6010
-- collect from here on.
UPDATE gl_accounts SET name = 'Wages — legacy (pre-split)',           is_active = false, report_group = 'admin_labor'       WHERE code = '5000';
UPDATE gl_accounts SET name = 'Payroll Taxes — legacy (pre-split)',   is_active = false, report_group = 'admin_labor'       WHERE code = '5010';
UPDATE gl_accounts SET name = 'Benefits — legacy (pre-split)',        is_active = false, report_group = 'admin_labor'       WHERE code = '5020';
UPDATE gl_accounts SET name = 'Contractor Labor — legacy (pre-split)', is_active = false, report_group = 'cogs_labor'       WHERE code = '5030';

-- ── 4. Reclassify the accounts that were already COGS in all but name ────────
-- 5100 held materials cost but sat under 'other_expense', which is exactly the
-- "COGS mixed in with expenses" problem. Retyping it moves that history into
-- the new COGS section — an intended correction, not a restatement.
UPDATE gl_accounts SET name = 'Vehicle Parts — Uncategorized', type = 'cogs', report_group = 'cogs_parts' WHERE code = '5100';
UPDATE gl_accounts SET type = 'cogs', report_group = 'cogs_other' WHERE code = '5900';

-- ── 5. The new chart ─────────────────────────────────────────────────────────
INSERT INTO gl_accounts (code, name, type, report_group, normal_balance) VALUES
  -- 5xxx COST OF GOODS SOLD — components installed on vehicles
  ('5110', 'Wire & Cable',                  'cogs', 'cogs_parts', 'debit'),
  ('5120', 'Emergency Lights',              'cogs', 'cogs_parts', 'debit'),
  ('5130', 'Sirens & Speakers',             'cogs', 'cogs_parts', 'debit'),
  ('5140', 'Consoles',                      'cogs', 'cogs_parts', 'debit'),
  ('5150', 'Partitions',                    'cogs', 'cogs_parts', 'debit'),
  ('5160', 'Gun Locks',                     'cogs', 'cogs_parts', 'debit'),
  ('5170', 'Mounting Brackets',             'cogs', 'cogs_parts', 'debit'),
  ('5180', 'Radios',                        'cogs', 'cogs_parts', 'debit'),
  ('5190', 'Cameras',                       'cogs', 'cogs_parts', 'debit'),
  ('5200', 'Graphics & Decals',             'cogs', 'cogs_parts', 'debit'),
  ('5210', 'Freight In',                    'cogs', 'cogs_parts', 'debit'),
  ('5220', 'Shop Supplies Used on Jobs',    'cogs', 'cogs_parts', 'debit'),
  -- 53xx COST OF GOODS SOLD — direct labor
  ('5300', 'Direct Labor — Installers',     'cogs', 'cogs_labor', 'debit'),
  ('5310', 'Direct Labor — Payroll Taxes',  'cogs', 'cogs_labor', 'debit'),
  ('5320', 'Contractor Labor',              'cogs', 'cogs_labor', 'debit'),
  -- 6xxx OPERATING EXPENSES
  ('6010', 'Payroll — Administrative',       'expense', 'admin_labor',       'debit'),
  ('6020', 'Payroll Taxes — Administrative', 'expense', 'admin_labor',       'debit'),
  ('6030', 'Benefits',                       'expense', 'admin_labor',       'debit'),
  -- 6130 Insurance is NOT inserted here: step 2 renumbered the existing
  -- Insurance account into it, so inserting would be a no-op that only looks
  -- like it worked.
  ('6140', 'Office Supplies',                'expense', 'operating_expense', 'debit'),
  ('6150', 'Fuel',                           'expense', 'operating_expense', 'debit'),
  ('6160', 'Vehicle Expense',                'expense', 'operating_expense', 'debit'),
  ('6170', 'Shop Supplies (non-job)',        'expense', 'operating_expense', 'debit'),
  ('6180', 'Advertising',                    'expense', 'operating_expense', 'debit'),
  ('6190', 'Training',                       'expense', 'operating_expense', 'debit'),
  ('6200', 'Repairs & Maintenance',          'expense', 'operating_expense', 'debit'),
  ('6210', 'Depreciation',                   'expense', 'operating_expense', 'debit')
ON CONFLICT (code) DO NOTHING;

-- Revenue keeps its group name.
UPDATE gl_accounts SET report_group = 'revenue' WHERE code = '4000';

-- ── 6. Enforce normal balance at the database level ──────────────────────────
-- App code derives this from the type so nobody can pick it (see
-- src/lib/chartOfAccounts.ts); this makes a direct SQL insert obey the same
-- rule, which is the point of the request — an expense account with a credit
-- normal balance, or a liability with a debit one, is always a mistake.
ALTER TABLE gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_normal_balance_matches_type;
ALTER TABLE gl_accounts ADD CONSTRAINT gl_accounts_normal_balance_matches_type CHECK (
  (type IN ('asset', 'expense', 'cogs') AND normal_balance = 'debit')
  OR
  (type IN ('liability', 'equity', 'revenue') AND normal_balance = 'credit')
);

-- A P&L account with report_group = 'none' appears on NOTHING: the P&L groups by
-- report_group, the balance sheet only reads balance-sheet types. It silently
-- absorbs postings that then show up in no statement. The reverse — a balance
-- sheet account carrying a P&L group — would double-count it. Both are blocked.
-- Which group, beyond that, is left to the app (src/lib/chartOfAccounts.ts):
-- historical rows still carry the pre-Phase-11 'labor' / 'other_expense' values
-- and must stay valid.
ALTER TABLE gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_report_group_matches_type;
ALTER TABLE gl_accounts ADD CONSTRAINT gl_accounts_report_group_matches_type CHECK (
  (type IN ('asset', 'liability', 'equity') AND report_group = 'none')
  OR
  (type IN ('revenue', 'cogs', 'expense') AND report_group <> 'none')
);

-- ── 7. Part category → COGS account ──────────────────────────────────────────
-- Twelve COGS accounts are only useful if something posts to them. Material
-- reaches COGS in exactly one place — the WIP→COGS settlement when a job closes
-- (src/lib/jobCosting.ts) — and that used to post the whole job as one line. It
-- now splits the job's material across these accounts in proportion to the
-- categories of the parts issued to it. This table is that mapping.
--
-- Case-insensitive on purpose: `parts.category` is free text, so "Sirens" and
-- "sirens" must be one mapping, not two that disagree.
CREATE TABLE IF NOT EXISTS part_category_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL,
  account_id  uuid NOT NULL REFERENCES gl_accounts(id) ON DELETE CASCADE,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS part_category_accounts_category_uidx
  ON part_category_accounts (lower(category));

-- ── 8. Seed the mapping from the categories already on parts ─────────────────
-- Keyword matching, ONCE, here — where you can read the result and change it —
-- rather than at posting time. Matches src/lib/cogsCategories.ts ::
-- COGS_CATEGORY_SUGGESTIONS; the lower priority number wins when a category
-- matches more than one keyword.
--
-- ON CONFLICT DO NOTHING, so re-running never overrides a mapping someone set by
-- hand on /accounting/cogs-categories. Categories that match nothing are left
-- unmapped and their material posts to 5100 Vehicle Parts — Uncategorized; that
-- page lists them so they don't stay that way by accident.
INSERT INTO part_category_accounts (category, account_id)
SELECT DISTINCT ON (lower(c.category)) c.category, a.id
  FROM (
    SELECT DISTINCT btrim(category) AS category
      FROM parts
     WHERE category IS NOT NULL AND btrim(category) <> ''
  ) c
  JOIN (VALUES
    ('wire', '5110',  1), ('cable', '5110',  2), ('wiring', '5110',  3), ('harness', '5110',  4), ('connector', '5110',  5),
    ('light', '5120',  6), ('lightbar', '5120',  7), ('led', '5120',  8), ('beacon', '5120',  9), ('strobe', '5120', 10),
    ('siren', '5130', 11), ('speaker', '5130', 12), ('horn', '5130', 13), ('amplifier', '5130', 14),
    ('console', '5140', 15), ('armrest', '5140', 16), ('cup holder', '5140', 17),
    ('partition', '5150', 18), ('cage', '5150', 19), ('prisoner', '5150', 20), ('transport seat', '5150', 21),
    ('gun lock', '5160', 22), ('gunlock', '5160', 23), ('weapon', '5160', 24), ('rifle', '5160', 25), ('shotgun', '5160', 26),
    ('bracket', '5170', 27), ('mount', '5170', 28), ('mounting', '5170', 29), ('pedestal', '5170', 30), ('pole', '5170', 31),
    ('radio', '5180', 32), ('antenna', '5180', 33), ('microphone', '5180', 34),
    ('camera', '5190', 35), ('dash cam', '5190', 36), ('dashcam', '5190', 37), ('video', '5190', 38),
    ('graphic', '5200', 39), ('decal', '5200', 40), ('wrap', '5200', 41), ('lettering', '5200', 42), ('reflective', '5200', 43),
    ('freight', '5210', 44), ('shipping', '5210', 45),
    ('shop supply', '5220', 46), ('shop supplies', '5220', 47), ('consumable', '5220', 48), ('hardware', '5220', 49), ('fastener', '5220', 50)
  ) AS k(pattern, code, priority)
    ON lower(c.category) LIKE '%' || k.pattern || '%'
  JOIN gl_accounts a ON a.code = k.code
 ORDER BY lower(c.category), k.priority
ON CONFLICT (lower(category)) DO NOTHING;

-- ── Verify ───────────────────────────────────────────────────────────────────
--   SELECT code, name, type, report_group, is_active
--     FROM gl_accounts ORDER BY code;
-- Expect: no 6000/6010/6020 as Rent/Utilities/Software (they are 6100/6110/6120),
-- 5000–5030 inactive and marked legacy, 5100 typed 'cogs', and the full 51xx–53xx
-- and 6xxx sets present.
--
-- Which part categories now route where, and which still don't:
--   SELECT p.category, COUNT(*) AS parts, a.code, a.name
--     FROM parts p
--     LEFT JOIN part_category_accounts m ON lower(m.category) = lower(btrim(p.category))
--     LEFT JOIN gl_accounts a ON a.id = m.account_id
--    WHERE p.archived = false AND btrim(COALESCE(p.category, '')) <> ''
--    GROUP BY p.category, a.code, a.name
--    ORDER BY a.code NULLS FIRST, p.category;
-- Rows with a NULL code post to 5100 Uncategorized until mapped at
-- /accounting/cogs-categories.
--
-- Nothing missing? This should return no rows. A code shows up here if its
-- destination was already taken when step 2 ran, which skips the renumber and then
-- skips the insert:
--   SELECT c.code FROM (VALUES
--     ('4000'),('5100'),('5110'),('5120'),('5130'),('5140'),('5150'),('5160'),
--     ('5170'),('5180'),('5190'),('5200'),('5210'),('5220'),('5300'),('5310'),
--     ('5320'),('5900'),('6010'),('6020'),('6030'),('6100'),('6110'),('6120'),
--     ('6130'),('6140'),('6150'),('6160'),('6170'),('6180'),('6190'),('6200'),
--     ('6210')) AS c(code)
--    WHERE NOT EXISTS (SELECT 1 FROM gl_accounts a WHERE a.code = c.code);
