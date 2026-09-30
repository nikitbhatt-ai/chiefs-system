-- ============================================================================
-- Invoices as a separate entity (customer + accounting document).
-- Run this in Neon's SQL Editor. Safe to run more than once.
--
-- The invoice is its own record with its own status + payments, but it is
-- NOT its own number: it carries the same 4-digit job number as the quote
-- (Q-0204) and work order (WO-0204) it came from — stored here as the raw
-- digits ("0204") in document_number. Job numbering itself lives in
-- docs/sql/doc_numbers.sql; run that first.
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Shared job number as digits (e.g. '0204'); matches the quote + WO.
  document_number text,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',   -- draft|sent|partial|paid|overdue|void
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_total numeric(12,2) NOT NULL DEFAULT 0,
  tax_total numeric(12,2) NOT NULL DEFAULT 0,
  grand_total numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  balance_due numeric(12,2) NOT NULL DEFAULT 0,
  due_date timestamp,
  sent_at timestamp,
  paid_at timestamp,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_customer_idx   ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS invoices_deal_idx        ON invoices (deal_id);
CREATE INDEX IF NOT EXISTS invoices_work_order_idx  ON invoices (work_order_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx      ON invoices (status);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  method text NOT NULL,                   -- cash|check|card|ach|other
  reference text,
  received_at timestamp NOT NULL DEFAULT now(),
  received_by uuid REFERENCES users(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON invoice_payments (invoice_id);
