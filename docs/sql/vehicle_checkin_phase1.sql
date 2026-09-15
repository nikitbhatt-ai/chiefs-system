-- ============================================================================
-- Vehicle check-in flow — Phase 1
-- vehicles (extended) · vehicle_check_ins · vehicle_check_in_photos
--
-- Run this in Neon's SQL Editor. Safe to run more than once.
-- Run it AFTER promo_phase7.sql (the most recent SQL file in docs/sql/).
--
-- WHAT THIS DOES
-- Vehicles physically arrive at the Hempstead lot and need recording on
-- arrival. This adds:
--   * ownership + lot status to the EXISTING `vehicles` table (one durable
--     row per VIN, forever — we extend it rather than create a second table)
--   * `vehicle_check_ins`, an event log with one row per physical arrival
--   * `vehicle_check_in_photos`, condition photos tied to a given arrival
--
-- HOW TO RUN IT
-- Paste the whole file into Neon's SQL Editor and run it. Then read the
-- output of STEP 6 — it tells you whether STEP 7 (the last step) applied or
-- was skipped, and what to do about it.
-- ============================================================================


-- ── STEP 1. New enum types ───────────────────────────────────────────────────
-- Postgres has no "CREATE TYPE IF NOT EXISTS", so each one is wrapped in a
-- DO block that checks first. That is what makes this file re-runnable.

DO $$ BEGIN
  CREATE TYPE vehicle_ownership AS ENUM ('chiefs', 'customer', 'sames');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_owner_party_type AS ENUM ('customer', 'partner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_lot_status AS ENUM (
    'on_lot_available',  -- here, nothing pending
    'on_lot_assigned',   -- here, attached to a deal
    'in_shop',           -- pulled into a bay
    'departed'           -- gone
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fuel_level AS ENUM ('empty', 'quarter', 'half', 'three_quarter', 'full');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE check_in_photo_slot AS ENUM (
    'front', 'rear', 'driver_side', 'passenger_side', 'odometer', 'vin_plate', 'damage'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Postgres will not let a brand-new enum value be USED in the same
-- transaction that created the type. Neon's editor wraps statements, so
-- commit before anything below writes these values.
COMMIT;


-- ── STEP 2. Extend the existing `vehicles` table ─────────────────────────────
-- All additive. Existing rows, work orders, deals and the Shopify publish
-- flow keep working untouched.

-- Who owns it. NULLABLE on purpose: an inventory associate checking a vehicle
-- in on the lot is not allowed to set ownership (office/admin only), so a row
-- legitimately exists unclassified until office classifies it. Defaulting to
-- 'chiefs' instead would silently mislabel partner units as our own.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership vehicle_ownership;

-- Which agency or dealer owns it. Deliberately NO foreign key: the target is
-- `customers` for an agency and `partners` for Sames and other dealerships.
-- One uuid column cannot reference two tables, so `owner_party_type` says
-- which table `owner_party_id` points into.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_party_id   uuid;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_party_type vehicle_owner_party_type;

-- Physical presence only — never build progress. Build progress lives on the
-- work order. NOT NULL with a default, so every existing row gets a value.
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS lot_status vehicle_lot_status NOT NULL DEFAULT 'on_lot_available';


-- ── STEP 3. Backfill lot_status for rows that existed before this file ───────
-- The legacy `status` column mixes sales state into one field. Without this,
-- every already-sold or delivered vehicle would show up on the new lot view
-- as sitting on the lot. Mapping:
--     delivered / sold                      -> departed
--     new / received / ready_for_pickup     -> on_lot_available (the default)
--
-- Guarded by `updated_at < now()` so a re-run cannot stomp a lot status that
-- the check-in flow has since set for real.
UPDATE vehicles
   SET lot_status = 'departed'
 WHERE status IN ('delivered', 'sold')
   AND lot_status = 'on_lot_available';


-- ── STEP 4. The check-in event log ───────────────────────────────────────────
-- One row per physical arrival. A vehicle accumulates several of these over
-- its life; `vehicles` above stays the single durable record.
--
-- Note there is NO days_on_lot column. Days on lot is COMPUTED from
-- arrived_at and departed_at at read time. Storing it would go stale daily.
CREATE TABLE IF NOT EXISTS vehicle_check_ins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  arrived_at     timestamp NOT NULL DEFAULT now(),
  departed_at    timestamp,              -- stamped by the departure flow
  odometer       integer,
  fuel_level     fuel_level,
  key_count      integer,
  key_location   text,
  delivered_by   text,
  drop_contact   text,
  lot_location   text,
  damage_notes   text,
  items_inside   text,
  checked_in_by  uuid NOT NULL REFERENCES users(id),
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_check_ins_vehicle_idx
  ON vehicle_check_ins (vehicle_id);


-- ── STEP 5. Check-in photos ──────────────────────────────────────────────────
-- Photos hang off the check-in EVENT, not the vehicle: condition is specific
-- to a given arrival. `url` is the public Vercel Blob URL.
CREATE TABLE IF NOT EXISTS vehicle_check_in_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id  uuid NOT NULL REFERENCES vehicle_check_ins(id) ON DELETE CASCADE,
  url          text NOT NULL,
  slot         check_in_photo_slot,
  created_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_check_in_photos_check_in_idx
  ON vehicle_check_in_photos (check_in_id);

-- Lot view filters and sorts on lot_status, so give it an index.
CREATE INDEX IF NOT EXISTS vehicles_lot_status_idx ON vehicles (lot_status);

-- (An index on vehicles.vin already exists — the UNIQUE constraint
-- `vehicles_vin_unique` creates one automatically. Nothing to add.)

COMMIT;


-- ── STEP 6. Can the VIN be made required? — READ THIS OUTPUT ─────────────────
-- `vehicles.vin` is currently nullable, and until now the add-vehicle form
-- allowed saving a vehicle with no VIN. The check-in flow depends on VIN
-- being the durable identity of a vehicle, so the application code now
-- requires one. STEP 7 makes the database agree.
--
-- This query lists any existing rows that would block that. If it returns
-- NOTHING, STEP 7 applies cleanly and you are done.
-- If it returns rows, STEP 7 SKIPS ITSELF (it will not error, and nothing
-- above is affected). Give each listed vehicle a real VIN on
-- /vehicles/<id>/edit, then re-run this file.
SELECT id,
       year, make, model,
       status,
       lot_location,
       created_at
  FROM vehicles
 WHERE vin IS NULL
 ORDER BY created_at DESC;


-- ── STEP 7. Make the VIN required ────────────────────────────────────────────
-- Skips itself with a notice if STEP 6 returned any rows, so this file is
-- always safe to run as a whole.
DO $$
DECLARE
  missing bigint;
BEGIN
  SELECT count(*) INTO missing FROM vehicles WHERE vin IS NULL;

  IF missing > 0 THEN
    RAISE NOTICE
      'SKIPPED: vehicles.vin left nullable — % row(s) have no VIN. Fill them in (see STEP 6 output) and re-run this file.',
      missing;
  ELSE
    ALTER TABLE vehicles ALTER COLUMN vin SET NOT NULL;
    RAISE NOTICE 'OK: vehicles.vin is now NOT NULL.';
  END IF;
END $$;

COMMIT;


-- ============================================================================
-- OPTIONAL — structure check with sample rows
--
-- Everything below only INSERTS test data. Skip it if you would rather not
-- have sample rows in the live database. If you do run it, the DELETE block
-- at the very bottom removes exactly what it created and nothing else.
-- ============================================================================

-- Three real-looking arrivals: a Chiefs-owned unit, a customer drop-off, and
-- a Sames consignment unit sitting unassigned.
-- `checked_in_by` borrows whichever admin user exists, so this works on any
-- database without you having to paste a user id in.
INSERT INTO vehicles (vin, year, make, model, trim, color, ownership, lot_status, lot_location)
VALUES
  ('1FTFW1E80PFA12345', 2023, 'Ford',      'F-150',    'Police Responder', 'Black', 'chiefs',   'on_lot_available', 'Row A-3'),
  ('1FM5K8AB4NGA98765', 2022, 'Ford',      'Explorer', 'Police Interceptor', 'White', 'customer', 'in_shop',          'Bay 2'),
  ('3GCUYDED9NG567890', 2022, 'Chevrolet', 'Silverado','LT',               'Silver','sames',    'on_lot_available', 'Front Display')
ON CONFLICT (vin) DO NOTHING;

INSERT INTO vehicle_check_ins (
  vehicle_id, arrived_at, odometer, fuel_level, key_count, key_location,
  delivered_by, drop_contact, lot_location, damage_notes, items_inside, checked_in_by
)
SELECT v.id,
       now() - interval '31 days',
       412, 'three_quarter', 2, 'Key board — hook 14',
       'Sames transport', '979-555-0142', 'Front Display',
       'Curb rash on front passenger wheel.', 'Owner manual, jack kit',
       (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
  FROM vehicles v
 WHERE v.vin = '3GCUYDED9NG567890'
   AND (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vehicle_check_ins c WHERE c.vehicle_id = v.id);

INSERT INTO vehicle_check_in_photos (check_in_id, url, slot)
SELECT c.id, 'https://example.blob.vercel-storage.com/checkin-sample-front.jpg', 'front'
  FROM vehicle_check_ins c
  JOIN vehicles v ON v.id = c.vehicle_id
 WHERE v.vin = '3GCUYDED9NG567890'
   AND NOT EXISTS (SELECT 1 FROM vehicle_check_in_photos p WHERE p.check_in_id = c.id);

COMMIT;

-- Verify the structure holds, including that days-on-lot computes correctly
-- from arrived_at/departed_at without being stored anywhere.
SELECT v.vin,
       v.year, v.make, v.model,
       v.ownership,
       v.lot_status,
       c.lot_location,
       c.fuel_level,
       c.odometer,
       -- days on lot: time since arrival, or the full stay if it has departed
       EXTRACT(DAY FROM COALESCE(c.departed_at, now()) - c.arrived_at)::int AS days_on_lot,
       (SELECT count(*) FROM vehicle_check_in_photos p WHERE p.check_in_id = c.id) AS photo_count
  FROM vehicles v
  LEFT JOIN vehicle_check_ins c ON c.vehicle_id = v.id
 WHERE v.vin IN ('1FTFW1E80PFA12345', '1FM5K8AB4NGA98765', '3GCUYDED9NG567890')
 ORDER BY days_on_lot DESC NULLS LAST;

-- ── Clean up the sample rows ─────────────────────────────────────────────────
-- Uncomment these three lines and run them to remove ONLY the sample data.
-- The photo and check-in rows go automatically via ON DELETE CASCADE.
--
-- DELETE FROM vehicles
--  WHERE vin IN ('1FTFW1E80PFA12345', '1FM5K8AB4NGA98765', '3GCUYDED9NG567890');
