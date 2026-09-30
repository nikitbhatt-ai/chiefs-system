-- Promo packages — Phase 6: reorder points, reserved-stock override, backfill.
--
-- Run in Neon's SQL Editor. Safe to re-run. Mirrors src/db/schema.ts ::
-- reorderPoint / stockOverrideLog / backfillRequisition.

DO $$ BEGIN
  CREATE TYPE backfill_trigger AS ENUM ('reorder_point', 'reserved_override');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE backfill_status AS ENUM ('open', 'ordered', 'received');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS reorder_point (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id        uuid NOT NULL UNIQUE REFERENCES parts(id) ON DELETE CASCADE,
  sku            text,
  min_qty        integer NOT NULL DEFAULT 0,
  reorder_to_qty integer NOT NULL DEFAULT 0,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reorder_point_part_idx ON reorder_point (part_id);

CREATE TABLE IF NOT EXISTS stock_override_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  part_id       uuid REFERENCES parts(id) ON DELETE SET NULL,
  sku           text,
  qty           integer NOT NULL,
  reason        text NOT NULL,
  user_id       uuid REFERENCES users(id),
  created_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_override_log_part_idx ON stock_override_log (part_id);

CREATE TABLE IF NOT EXISTS backfill_requisition (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id            uuid REFERENCES parts(id) ON DELETE SET NULL,
  sku                text,
  qty                integer NOT NULL,
  triggered_by       backfill_trigger NOT NULL,
  source_override_id uuid REFERENCES stock_override_log(id) ON DELETE SET NULL,
  need_by            date,
  status             backfill_status NOT NULL DEFAULT 'open',
  purchase_order_id  uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS backfill_requisition_part_idx ON backfill_requisition (part_id);
CREATE INDEX IF NOT EXISTS backfill_requisition_status_idx ON backfill_requisition (status);
