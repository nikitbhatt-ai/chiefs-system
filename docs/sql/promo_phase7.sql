-- ============================================================================
-- Packages: cost/markup pricing + bundle price · Purchase orders: status workflow
-- Run this in Neon's SQL Editor. Safe to run more than once.
--
-- WHY THIS FILE EXISTS
-- The features it covers shipped without any SQL alongside them (PRs #93–#98:
-- package cost/markup pricing, markup-vs-margin mode, promo→package, and the
-- Pending → Ordered → Received → Fulfilled purchase-order workflow). The code on
-- `main` reads and writes these columns, so until this runs, those screens error
-- against the live database — `src/db/schema.ts` declares them and the database
-- does not have them.
--
-- Run it AFTER accounting_phase11.sql. It touches nothing accounting.
-- ============================================================================

-- ── 1. Purchase order status workflow ────────────────────────────────────────
-- Additive only. The legacy values (pending_review, po_received, received) stay
-- valid so existing POs keep their status; nothing is renamed or removed.
--   pending → ordered → partially_received → fulfilled
ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'ordered';
ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'fulfilled';

-- Postgres will not let a new enum value be USED in the same transaction that
-- added it. Neon's editor wraps statements, so commit before anything below
-- reads or writes these values.
COMMIT;

-- ── 2. Package pricing ───────────────────────────────────────────────────────
-- All nullable, no backfill: an existing package with none of these set behaves
-- exactly as it did — à la carte line prices, no default markup.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS package_price numeric(12,2);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS markup_pct    numeric(5,2);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS pricing_mode  text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS source_promo_id uuid;

-- Separate from the ADD COLUMN so a re-run does not fail on an existing
-- constraint, and so the column still lands if vendor_promo is somehow absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_promo')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'packages_source_promo_id_fkey'
     )
  THEN
    ALTER TABLE packages
      ADD CONSTRAINT packages_source_promo_id_fkey
      FOREIGN KEY (source_promo_id) REFERENCES vendor_promo(id) ON DELETE SET NULL;
  END IF;
END $$;

-- What they mean:
--   package_price   sell-side bundle/deal price for the package's PARTS. Null =
--                   quote at à la carte line prices. When set, dropping the
--                   package on a quote allocates this total across the part
--                   lines. Distinct from vendor_promo.package_price, which is
--                   the PURCHASE side.
--   markup_pct      default markup applied to each line's internal cost to get
--                   its sell price. Null = no default.
--   pricing_mode    how markup_pct is read: 'markup' (% on cost, sell =
--                   cost × (1+p)) or 'margin' (% off list, sell = cost ÷ (1−p)).
--                   Null behaves as 'markup'.
--   source_promo_id set when the package was generated from a vendor promo, so
--                   re-syncing updates in place instead of clobbering a
--                   hand-set bundle price. Null for hand-built packages.

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect four rows:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'packages'
--      AND column_name IN ('package_price','markup_pct','pricing_mode','source_promo_id')
--    ORDER BY column_name;
--
-- Expect 'ordered' and 'fulfilled' present:
--   SELECT unnest(enum_range(NULL::purchase_order_status));
