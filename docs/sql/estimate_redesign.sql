-- Estimate page redesign (2026-09-30). Run once in Neon's SQL Editor
-- BEFORE deploying the code that uses these columns.
-- Safe to re-run: every statement is IF NOT EXISTS / idempotent.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_po text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS hide_line_prices boolean NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_rate numeric(6,3);

-- Existing estimates for tax-exempt customers that carry no tax: mark the
-- estimate itself tax-exempt so the new switch shows the truth.
UPDATE quotes q
SET tax_exempt = true
FROM customers c
WHERE q.customer_id = c.id
  AND c.tax_exempt = true
  AND COALESCE(q.tax_total, 0) = 0
  AND q.tax_exempt = false;
