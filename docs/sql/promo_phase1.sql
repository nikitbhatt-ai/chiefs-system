-- Promo packages — Phase 1: vendor à la carte price list.
--
-- Run in Neon's SQL Editor. Safe to re-run (IF NOT EXISTS throughout).
-- Schema mirrors src/db/schema.ts :: vendorPartPrice.

CREATE TABLE IF NOT EXISTS vendor_part_price (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id          uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  sku                text NOT NULL,
  alacarte_unit_cost numeric(12,2) NOT NULL,
  effective_from     date NOT NULL DEFAULT CURRENT_DATE,
  effective_to       date,
  source_note        text,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_part_price_vendor_sku_idx
  ON vendor_part_price (vendor_id, sku);
CREATE INDEX IF NOT EXISTS vendor_part_price_sku_idx
  ON vendor_part_price (sku);

-- At most one CURRENT (effective_to IS NULL) price per vendor+sku. History rows
-- (effective_to set) are exempt, so a SKU can accumulate many closed rows but
-- only ever one open one.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_part_price_current_uq
  ON vendor_part_price (vendor_id, sku)
  WHERE effective_to IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed — Whelen F-150 à la carte price file.
--
-- Only the two unit costs the brief states verbatim are seeded here (XI3JC
-- 112.00, TCRWX6 1282.80); the remaining ~15 lines of the reconciled sheet are
-- not in the repo, so they are NOT invented — a fabricated basis would make
-- Phase 3's $6,840 / ~$2,590-saving reconciliation wrong. Load the full sheet
-- either through the /vendor-pricing admin screen or by extending the VALUES
-- list below, then re-run.
--
-- Replace 'Whelen' if the vendor row is named differently; the subquery resolves
-- the vendor by name and does nothing if no such vendor exists yet.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO vendor_part_price (vendor_id, sku, alacarte_unit_cost, source_note)
SELECT v.id, s.sku, s.cost, 'Whelen dealer net — F-150 price file (brief 2026-08-03)'
FROM (VALUES
  ('XI3JC',  112.00::numeric(12,2)),
  ('TCRWX6', 1282.80::numeric(12,2))
) AS s(sku, cost)
JOIN vendors v ON v.name = 'Whelen'
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_part_price p
  WHERE p.vendor_id = v.id AND p.sku = s.sku AND p.effective_to IS NULL
);
