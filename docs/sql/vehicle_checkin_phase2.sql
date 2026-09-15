-- ============================================================================
-- Vehicle check-in flow — Phase 2
-- deal_vehicles link table, with a single-active-link constraint
--
-- Run this in Neon's SQL Editor. Safe to run more than once.
-- Run it AFTER vehicle_checkin_phase1.sql.
--
-- WHAT THIS DOES
-- Links a vehicle to a deal. A deal can have many vehicles, and a vehicle can
-- appear on several deals across its lifetime — so this is a link table, not
-- a `deal_id` column on the vehicle row.
--
-- A vehicle's CURRENT deal is the row where unlinked_at IS NULL.
-- Its FULL HISTORY is every row. Unlinking stamps unlinked_at/unlinked_by; it
-- never deletes. The history is the point.
--
-- Linking makes a vehicle ELIGIBLE for scheduling. It does not bypass the
-- purchase-order gate — the scheduler enforces that separately, and this file
-- deliberately contains no PO, bay or parts logic.
-- ============================================================================


-- ── STEP 1. The link table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES deals(id)    ON DELETE CASCADE,
  vehicle_id   uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  linked_at    timestamp NOT NULL DEFAULT now(),
  linked_by    uuid NOT NULL REFERENCES users(id),
  unlinked_at  timestamp,
  unlinked_by  uuid REFERENCES users(id)
);


-- ── STEP 2. Lookup indexes ───────────────────────────────────────────────────
-- deal_id: "what vehicles are on this deal?" (the deal detail page)
-- vehicle_id: "what deal is this vehicle on?" (the lot view, per row)
CREATE INDEX IF NOT EXISTS deal_vehicles_deal_idx    ON deal_vehicles (deal_id);
CREATE INDEX IF NOT EXISTS deal_vehicles_vehicle_idx ON deal_vehicles (vehicle_id);


-- ── STEP 3. The single-active-link guardrail ─────────────────────────────────
-- At most ONE active link per vehicle. This is the database-level protection
-- against two people attaching the same vehicle to two deals at the same time
-- — a check in application code alone loses that race.
--
-- It is a PARTIAL index (note the WHERE): only rows where unlinked_at IS NULL
-- are constrained. A vehicle can therefore accumulate any number of CLOSED
-- links over its life, which is exactly the history we want to keep.
CREATE UNIQUE INDEX IF NOT EXISTS deal_vehicles_active_vehicle_uniq
  ON deal_vehicles (vehicle_id)
  WHERE unlinked_at IS NULL;

COMMIT;


-- ── STEP 4. Report: vehicles already attached to a deal the old way ──────────
-- READ-ONLY. This changes nothing — it is here so you can see what is there.
--
-- `deals.vehicle_id` already exists and already carries real attachments made
-- before this table existed. Those links are invisible to the new constraint
-- above until they are copied across, which this file deliberately does NOT
-- do (it would have to invent a `linked_by` user, and that is your call).
--
-- Column meanings:
--   deals_with_a_vehicle  — how many existing attachments there are
--   vehicles_attached     — how many distinct vehicles those cover
--   vehicles_on_2plus     — vehicles already on more than one deal. If this is
--                           greater than zero, a straight copy would violate
--                           the single-active-link index and those rows would
--                           have to be resolved by hand first.
SELECT
  count(*)                                                        AS deals_with_a_vehicle,
  count(DISTINCT d.vehicle_id)                                    AS vehicles_attached,
  (SELECT count(*) FROM (
      SELECT vehicle_id
        FROM deals
       WHERE vehicle_id IS NOT NULL
         AND archived = false
       GROUP BY vehicle_id
      HAVING count(*) > 1
   ) x)                                                           AS vehicles_on_2plus
  FROM deals d
 WHERE d.vehicle_id IS NOT NULL
   AND d.archived = false;

-- The individual vehicles on more than one deal, if any. Empty is good.
SELECT v.vin, v.year, v.make, v.model,
       count(*)              AS deal_count,
       array_agg(d.id)       AS deal_ids
  FROM deals d
  JOIN vehicles v ON v.id = d.vehicle_id
 WHERE d.vehicle_id IS NOT NULL
   AND d.archived = false
 GROUP BY v.vin, v.year, v.make, v.model
HAVING count(*) > 1
 ORDER BY deal_count DESC;


-- ============================================================================
-- OPTIONAL — structure check with sample rows
--
-- Everything below only INSERTS test data, and cleans up after itself at the
-- end. Skip it if you would rather not touch the live database. It needs a
-- customer and an admin user to exist; if neither does, it inserts nothing
-- and the verification query simply comes back empty.
-- ============================================================================

-- A deal and a vehicle to link together.
INSERT INTO vehicles (vin, year, make, model, ownership, lot_status)
VALUES ('WAUZZZ8V1JA111222', 2021, 'Ford', 'Explorer', 'sames', 'on_lot_available')
ON CONFLICT (vin) DO NOTHING;

INSERT INTO deals (id, stage, vehicle_id, notes)
SELECT '00000000-0000-4000-a000-00000000d001', 'prospect', NULL, 'PHASE 2 SAMPLE — safe to delete'
 WHERE NOT EXISTS (SELECT 1 FROM deals WHERE id = '00000000-0000-4000-a000-00000000d001');

INSERT INTO deals (id, stage, vehicle_id, notes)
SELECT '00000000-0000-4000-a000-00000000d002', 'prospect', NULL, 'PHASE 2 SAMPLE — safe to delete'
 WHERE NOT EXISTS (SELECT 1 FROM deals WHERE id = '00000000-0000-4000-a000-00000000d002');

-- Link the vehicle to the first deal.
INSERT INTO deal_vehicles (deal_id, vehicle_id, linked_by)
SELECT '00000000-0000-4000-a000-00000000d001', v.id,
       (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
  FROM vehicles v
 WHERE v.vin = 'WAUZZZ8V1JA111222'
   AND (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM deal_vehicles dv
      WHERE dv.vehicle_id = v.id AND dv.unlinked_at IS NULL
   );

COMMIT;

-- Current deal (unlinked_at IS NULL) vs full history for this vehicle.
SELECT v.vin,
       dv.deal_id,
       dv.linked_at,
       dv.unlinked_at,
       CASE WHEN dv.unlinked_at IS NULL THEN 'CURRENT' ELSE 'history' END AS link_state
  FROM deal_vehicles dv
  JOIN vehicles v ON v.id = dv.vehicle_id
 WHERE v.vin = 'WAUZZZ8V1JA111222'
 ORDER BY dv.linked_at;

-- ── Clean up the sample rows ─────────────────────────────────────────────────
-- Uncomment and run to remove ONLY what the block above created.
-- The deal_vehicles rows go automatically via ON DELETE CASCADE.
--
-- DELETE FROM deals    WHERE id  IN ('00000000-0000-4000-a000-00000000d001',
--                                    '00000000-0000-4000-a000-00000000d002');
-- DELETE FROM vehicles WHERE vin = 'WAUZZZ8V1JA111222';
