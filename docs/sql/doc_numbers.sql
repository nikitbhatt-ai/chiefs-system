-- ============================================================================
-- Document numbers: one job number for quotes / invoices / work orders,
-- a separate series for purchase orders.
-- Run this in Neon's SQL Editor. Safe to run more than once.
--
-- WHAT CHANGES
--   Quotes & invoices   Q-6639059  ->  Q-02042     (5 digits)
--   Work orders         WO-1234567 ->  WO-02042    (5 digits, SAME as its quote)
--   Purchase orders     PO-1234567 ->  PO-000001   (6 digits, own series)
--
-- A quote, the invoice it becomes and the work order that builds it are one
-- job, so they share one number and differ only by prefix — the way the shop's
-- previous system worked (Estimate #1938 and Work Order #1938 were one job).
-- Purchase orders are not part of a job's identity (one PO can supply several
-- jobs), so they run on their own series.
--
-- Numbers were previously the last 7 digits of the clock, which is neither
-- unique (two records created in the same millisecond collided on a UNIQUE
-- column) nor ordered. These are Postgres sequences: atomic, and they count.
--
-- IMPORTING FROM THE PREVIOUS SYSTEM — read section 6 BEFORE importing.
--
-- HOW A ROW IS CLASSIFIED (this is the whole trick)
--   old format  = legacy_number IS NULL AND the number is PREFIX- + exactly 7
--                 digits. That is precisely what the clock produced, and
--                 nothing this app will issue for the next million jobs.
--   in-series   = everything else: already renumbered (it has a legacy_number),
--                 or imported, or issued by the new sequences.
-- Only old-format rows are renumbered, so a re-run is a no-op and a record
-- imported from the old system is never rewritten.
-- ============================================================================

-- ── 1. Keep the old number findable ─────────────────────────────────────────
-- Renumbering rewrites what is printed on a document. Anything already sent to
-- a customer now shows a number they cannot find, so the old one is kept and
-- indexed rather than thrown away.
ALTER TABLE quotes          ADD COLUMN IF NOT EXISTS legacy_number text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS legacy_number text;
ALTER TABLE work_orders     ADD COLUMN IF NOT EXISTS legacy_number text;

CREATE INDEX IF NOT EXISTS quotes_legacy_number_idx          ON quotes (legacy_number);
CREATE INDEX IF NOT EXISTS purchase_orders_legacy_number_idx ON purchase_orders (legacy_number);
CREATE INDEX IF NOT EXISTS work_orders_legacy_number_idx     ON work_orders (legacy_number);

-- ── 2. The sequences ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS job_number_seq AS bigint START WITH 1 MINVALUE 1;
CREATE SEQUENCE IF NOT EXISTS po_number_seq  AS bigint START WITH 1 MINVALUE 1;

-- ── 3. Park each sequence above the numbers ALREADY IN THE SERIES ───────────
-- Before renumbering, not just after: the numbers handed out below must
-- continue from the imported records rather than collide with them. Imports are
-- deliberately included and old clock-format numbers deliberately are not, so
-- if #2041 came over from the previous system the next new job is #2042.
SELECT setval('job_number_seq', GREATEST(m, 1), m > 0) FROM (
  SELECT GREATEST(
    (SELECT COALESCE(MAX(NULLIF(substring(quote_number from '\d+$'), '')::bigint), 0)
       FROM quotes
      WHERE NOT (legacy_number IS NULL AND quote_number ~ '^Q-\d{7}$')),
    (SELECT COALESCE(MAX(NULLIF(substring(wo_number from '\d+$'), '')::bigint), 0)
       FROM work_orders
      WHERE NOT (legacy_number IS NULL AND wo_number ~ '^WO-\d{7}$'))
  ) AS m
) s;

SELECT setval('po_number_seq', GREATEST(m, 1), m > 0) FROM (
  SELECT (SELECT COALESCE(MAX(NULLIF(substring(po_number from '\d+$'), '')::bigint), 0)
            FROM purchase_orders
           WHERE NOT (legacy_number IS NULL AND po_number ~ '^PO-\d{7}$')) AS m
) s;

-- ── 4. Renumber what the app created ────────────────────────────────────────
-- Oldest first, so the new numbers run in the order the work actually happened
-- rather than in whatever order the table returns.

-- 4a. Quotes (and therefore invoices — same row).
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT id FROM quotes
     WHERE legacy_number IS NULL
       AND (quote_number IS NULL OR quote_number ~ '^Q-\d{7}$')
     ORDER BY created_at, id
  LOOP
    n := nextval('job_number_seq');
    UPDATE quotes
       SET legacy_number = COALESCE(quote_number, '(none)'),
           quote_number  = 'Q-' || lpad(n::text, 5, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

-- 4b. A work order that belongs to a quote takes THAT quote's number, so the
--     job reads the same across its documents. No sequence value is consumed.
UPDATE work_orders w
   SET legacy_number = COALESCE(w.wo_number, '(none)'),
       wo_number     = 'WO-' || substring(q.quote_number from '\d+$')
  FROM quotes q
 WHERE w.quote_id = q.id
   AND w.legacy_number IS NULL
   AND (w.wo_number IS NULL OR w.wo_number ~ '^WO-\d{7}$')
   AND q.quote_number ~ '^Q-\d+$';

-- 4c. A standalone work order (no quote behind it) draws its own job number.
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT id FROM work_orders
     WHERE legacy_number IS NULL
       AND (wo_number IS NULL OR wo_number ~ '^WO-\d{7}$')
     ORDER BY created_at, id
  LOOP
    n := nextval('job_number_seq');
    UPDATE work_orders
       SET legacy_number = COALESCE(wo_number, '(none)'),
           wo_number     = 'WO-' || lpad(n::text, 5, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

-- 4d. Purchase orders, six digits, own series.
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT id FROM purchase_orders
     WHERE legacy_number IS NULL
       AND (po_number IS NULL OR po_number ~ '^PO-\d{7}$')
     ORDER BY created_at, id
  LOOP
    n := nextval('po_number_seq');
    UPDATE purchase_orders
       SET legacy_number = COALESCE(po_number, '(none)'),
           po_number     = 'PO-' || lpad(n::text, 6, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

-- ── 5. Park the sequences above everything now in use ───────────────────────
-- 4b consumed no sequence value, so without this a work order's number could be
-- handed out again to a later quote.
SELECT setval('job_number_seq', GREATEST(m, 1), m > 0) FROM (
  SELECT GREATEST(
    (SELECT COALESCE(MAX(NULLIF(substring(quote_number from '\d+$'), '')::bigint), 0) FROM quotes),
    (SELECT COALESCE(MAX(NULLIF(substring(wo_number    from '\d+$'), '')::bigint), 0) FROM work_orders)
  ) AS m
) s;

SELECT setval('po_number_seq', GREATEST(m, 1), m > 0) FROM (
  SELECT (SELECT COALESCE(MAX(NULLIF(substring(po_number from '\d+$'), '')::bigint), 0)
            FROM purchase_orders) AS m
) s;

-- ── 6. IMPORTING INVOICES FROM THE PREVIOUS SYSTEM ──────────────────────────
-- The goal: an imported invoice keeps the number the customer already has.
--
-- Write the original number into BOTH quote_number and legacy_number. Section 4
-- skips any row that has a legacy_number, so an import is never renumbered, and
-- section 3 parks the sequence above it so no future job can be handed the same
-- number.
--
--   INSERT INTO quotes (quote_number, legacy_number, customer_id, status, ...)
--   VALUES ('Q-01938', '1938', :customer_id, 'converted', ...);
--
-- Two ways to write it, both supported — pick one and be consistent:
--
--   a) RECOMMENDED. Pad into this system's format: 1938 -> 'Q-01938'. The
--      digits still match the customer's paperwork, and the series simply
--      continues: if 2041 is the highest imported number, the next new job here
--      is Q-02042.
--
--   b) Keep the original string verbatim ('1938', 'INV-1938'). Not renumbered
--      either, but your lists then show two formats side by side.
--
-- Either way `legacy_number` holds what the old system called it and the app's
-- search matches on digits, so a customer quoting "1938" finds the record
-- whichever form it is stored in.
--
-- ORDER MATTERS: import first, then re-run this file. Sections 3 and 5 only
-- ever move a sequence to the maximum in use, and section 4 skips anything with
-- a legacy_number, so re-running after an import is safe and does the right
-- thing. Importing AFTER new jobs have been numbered risks an imported number
-- colliding with one already issued — the UNIQUE constraint will reject it.

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Quote, invoice and work order for one job read as the same number:
--   SELECT q.quote_number, w.wo_number, q.legacy_number
--     FROM quotes q LEFT JOIN work_orders w ON w.quote_id = q.id
--    ORDER BY q.created_at LIMIT 20;
--
-- Nothing left in the old clock format (expect 0 from each):
--   SELECT count(*) FROM quotes          WHERE quote_number ~ '^Q-\d{7}$'  AND legacy_number IS NULL;
--   SELECT count(*) FROM work_orders     WHERE wo_number    ~ '^WO-\d{7}$' AND legacy_number IS NULL;
--   SELECT count(*) FROM purchase_orders WHERE po_number    ~ '^PO-\d{7}$' AND legacy_number IS NULL;
--
-- Where the next numbers will come from:
--   SELECT last_value FROM job_number_seq;
--   SELECT last_value FROM po_number_seq;
