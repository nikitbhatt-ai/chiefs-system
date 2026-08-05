-- Promo packages — Phase 2: cost layers + weighted-average / FIFO costing spine.
--
-- Run in Neon's SQL Editor. Safe to re-run (guards throughout). Mirrors the
-- Phase 2 additions in src/db/schema.ts.
--
-- What this does:
--   1. Enum types: inventory_source_kind, costing_method.
--   2. Extends part_receipts (the existing FIFO layer table) with source_kind,
--      promo_id, receipt_key.
--   3. Adds parts.avg_cost numeric(12,4) — the weighted-average basis.
--   4. Creates inventory_issue (per-layer-slice consumption subledger).
--   5. Creates costing_policy (single row, default weighted_average).
--   6. OPTIONAL opening-balance backfill for stock that predates the layers.

-- ── 1. Enum types ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE inventory_source_kind AS ENUM ('package', 'individual', 'backfill', 'opening');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE costing_method AS ENUM ('weighted_average', 'fifo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Extend part_receipts ───────────────────────────────────────────────────
ALTER TABLE part_receipts
  ADD COLUMN IF NOT EXISTS source_kind inventory_source_kind NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS promo_id    uuid,
  ADD COLUMN IF NOT EXISTS receipt_key text;

CREATE INDEX IF NOT EXISTS part_receipts_promo_idx ON part_receipts (promo_id);

-- One receipt event = at most one layer. receipt_key is null for opening/legacy
-- layers, so a partial unique index (nulls exempt) is the right guard.
CREATE UNIQUE INDEX IF NOT EXISTS part_receipts_receipt_key_uq
  ON part_receipts (receipt_key)
  WHERE receipt_key IS NOT NULL;

-- ── 3. parts.avg_cost ─────────────────────────────────────────────────────────
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS avg_cost numeric(12,4);

-- ── 4. inventory_issue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_issue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id       uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  layer_id      uuid REFERENCES part_receipts(id) ON DELETE SET NULL,
  qty           integer NOT NULL,
  unit_cost     numeric(12,2) NOT NULL,
  issued_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_issue_part_idx ON inventory_issue (part_id);
CREATE INDEX IF NOT EXISTS inventory_issue_work_order_idx ON inventory_issue (work_order_id);
CREATE INDEX IF NOT EXISTS inventory_issue_layer_idx ON inventory_issue (layer_id);

-- ── 5. costing_policy (single row) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS costing_policy (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method     costing_method NOT NULL DEFAULT 'weighted_average',
  changed_by uuid REFERENCES users(id),
  changed_at timestamp NOT NULL DEFAULT now()
);
-- Seed the one policy row if the table is empty.
INSERT INTO costing_policy (method)
SELECT 'weighted_average'
WHERE NOT EXISTS (SELECT 1 FROM costing_policy);

-- ── 6. OPTIONAL: opening-balance backfill ──────────────────────────────────────
-- Stock loaded via the CSV import (or set directly on the part form) has an
-- on-hand count but no cost layers, so layer-sum < quantity_on_hand. This seeds
-- one `opening` layer per part for the shortfall, valued at parts.cost, dated far
-- in the past so FIFO drains it first. It makes on-hand == Σ layer remaining and
-- gives the moving average a starting basis.
--
-- Review before running: parts with a NULL cost get an opening layer at $0.00
-- (there's no cost to invent) — fix those parts' cost first if you want them
-- valued. Re-running is a no-op (guards on an existing opening layer per part).
INSERT INTO part_receipts (part_id, source_kind, quantity_received, quantity_remaining, unit_cost, received_at)
SELECT p.id, 'opening', shortfall, shortfall, COALESCE(p.cost, 0)::numeric(12,2), TIMESTAMP '2000-01-01 00:00:00'
FROM (
  SELECT p.id, p.cost,
         p.quantity_on_hand - COALESCE((
           SELECT SUM(r.quantity_remaining) FROM part_receipts r WHERE r.part_id = p.id
         ), 0) AS shortfall
  FROM parts p
) p
WHERE p.shortfall > 0
  AND NOT EXISTS (
    SELECT 1 FROM part_receipts r WHERE r.part_id = p.id AND r.source_kind = 'opening'
  );

-- Seed avg_cost from the resulting layers (weighted average of remaining stock)
-- wherever it's still null, then fall back to parts.cost for layerless parts.
UPDATE parts SET avg_cost = sub.avg
FROM (
  SELECT part_id, ROUND(SUM(quantity_remaining * unit_cost) / NULLIF(SUM(quantity_remaining), 0), 4) AS avg
  FROM part_receipts GROUP BY part_id
) sub
WHERE parts.id = sub.part_id AND parts.avg_cost IS NULL AND sub.avg IS NOT NULL;

UPDATE parts SET avg_cost = ROUND(cost, 4)
WHERE avg_cost IS NULL AND cost IS NOT NULL;
