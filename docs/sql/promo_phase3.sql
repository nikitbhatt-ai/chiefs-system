-- Promo packages — Phase 3: vendor promos + allocation engine data.
--
-- Run in Neon's SQL Editor. Safe to re-run. Mirrors src/db/schema.ts ::
-- vendorPromo / vendorPromoLine, and wires the part_receipts.promo_id FK that
-- Phase 2 left as a bare column.

-- Enum
DO $$ BEGIN
  CREATE TYPE vendor_promo_status AS ENUM ('active', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A vendor promo: one price for a fixed basket of parts.
CREATE TABLE IF NOT EXISTS vendor_promo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name           text NOT NULL,
  package_price  numeric(12,2) NOT NULL,
  freight        numeric(12,2),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  status         vendor_promo_status NOT NULL DEFAULT 'active',
  notes          text,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_promo_vendor_idx ON vendor_promo (vendor_id);
CREATE INDEX IF NOT EXISTS vendor_promo_status_idx ON vendor_promo (status);

-- Promo lines. alacarte_cost_snap is snapshotted from vendor_part_price at save
-- time; the allocated cost is computed by the engine and snapshotted onto the PO
-- line at PO creation (Phase 4), not stored here.
CREATE TABLE IF NOT EXISTS vendor_promo_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id           uuid NOT NULL REFERENCES vendor_promo(id) ON DELETE CASCADE,
  sku                text NOT NULL,
  quantity           integer NOT NULL DEFAULT 1,
  alacarte_cost_snap numeric(12,2) NOT NULL,
  created_at         timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_promo_line_promo_idx ON vendor_promo_line (promo_id);

-- Wire the Phase 2 part_receipts.promo_id column to vendor_promo now that the
-- table exists (skip if the constraint is already present).
DO $$ BEGIN
  ALTER TABLE part_receipts
    ADD CONSTRAINT part_receipts_promo_id_fk
    FOREIGN KEY (promo_id) REFERENCES vendor_promo(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
