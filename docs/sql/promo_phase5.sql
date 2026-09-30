-- Promo packages — Phase 5: reservations + available-to-pull.
--
-- Run in Neon's SQL Editor. Safe to re-run. Mirrors src/db/schema.ts ::
-- inventoryReservation.

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('active', 'fulfilled', 'released');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS inventory_reservation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  part_id       uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  sku           text,
  qty_reserved  integer NOT NULL,
  status        reservation_status NOT NULL DEFAULT 'active',
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_reservation_part_idx ON inventory_reservation (part_id);
CREATE INDEX IF NOT EXISTS inventory_reservation_work_order_idx ON inventory_reservation (work_order_id);
CREATE INDEX IF NOT EXISTS inventory_reservation_status_idx ON inventory_reservation (status);
