-- ============================================================================
-- Vehicle check-in flow — Phase 9
-- Backfill the legacy `deals.vehicle_id` attachments into `deal_vehicles`
--
-- Run this in Neon's SQL Editor. Safe to run more than once.
-- Run it AFTER vehicle_checkin_phase2.sql.
--
-- WHY THIS EXISTS
-- `deals.vehicle_id` predates the `deal_vehicles` link table and already holds
-- real vehicle-to-deal attachments. The single-active-link guardrail added in
-- Phase 2 only looks at `deal_vehicles`, so until those old attachments are
-- copied across they are invisible to it — and a vehicle already on a deal the
-- old way could be attached to a SECOND deal through the new flow.
--
-- This was not run in Phase 2 because a vehicle sitting on two or more open
-- deals would violate the new index and needs a human to say which deal is
-- right. The user ran the STEP 4 report on 2026-09-22 and it came back 0, so a
-- straight copy is safe. STEP 1 below re-checks that before writing anything —
-- do not assume, the data may have moved since.
--
-- `deals.vehicle_id` is NOT removed. Nothing is deleted or rewritten; this
-- only adds the missing link rows.
-- ============================================================================


-- ── STEP 1. Re-check that a clean copy is still possible ─────────────────────
-- READ-ONLY. If `blocking_vehicles` is 0, STEP 3 will copy everything.
-- If it is not 0, STEP 3 SKIPS ITSELF and STEP 2 lists what needs deciding.
SELECT
  (SELECT count(*) FROM deals
    WHERE vehicle_id IS NOT NULL AND archived = false)            AS legacy_attachments,
  (SELECT count(*) FROM (
     SELECT vehicle_id FROM deals
      WHERE vehicle_id IS NOT NULL AND archived = false
      GROUP BY vehicle_id HAVING count(*) > 1) x)                 AS blocking_vehicles;


-- ── STEP 2. Anything that needs a human decision. Empty is good. ─────────────
SELECT v.vin, v.year, v.make, v.model,
       count(*)        AS deal_count,
       array_agg(d.id) AS deal_ids
  FROM deals d
  JOIN vehicles v ON v.id = d.vehicle_id
 WHERE d.vehicle_id IS NOT NULL
   AND d.archived = false
 GROUP BY v.vin, v.year, v.make, v.model
HAVING count(*) > 1;


-- ── STEP 3. The backfill ─────────────────────────────────────────────────────
-- `linked_by` cannot be null, and there is no record of who made these old
-- attachments. Rather than inventing a person, every backfilled row is
-- attributed to the OLDEST ADMIN account and stamped with the deal's own
-- created_at, so the history reads as "migrated", not as somebody's action.
--
-- Skips any vehicle that already has an active link, so it is re-runnable and
-- so a link made through the new flow always wins over the legacy column.
DO $$
DECLARE
  blocking  bigint;
  actor     uuid;
  inserted  bigint;
BEGIN
  SELECT count(*) INTO blocking FROM (
    SELECT vehicle_id FROM deals
     WHERE vehicle_id IS NOT NULL AND archived = false
     GROUP BY vehicle_id HAVING count(*) > 1) x;

  IF blocking > 0 THEN
    RAISE NOTICE
      'SKIPPED: % vehicle(s) are on more than one open deal. See STEP 2, decide which deal is correct, then re-run.',
      blocking;
    RETURN;
  END IF;

  SELECT id INTO actor FROM users WHERE role = 'admin' AND active = true
   ORDER BY created_at LIMIT 1;

  IF actor IS NULL THEN
    RAISE NOTICE 'SKIPPED: no active admin user to attribute the migrated links to.';
    RETURN;
  END IF;

  INSERT INTO deal_vehicles (deal_id, vehicle_id, linked_at, linked_by)
  SELECT d.id, d.vehicle_id, d.created_at, actor
    FROM deals d
   WHERE d.vehicle_id IS NOT NULL
     AND d.archived = false
     AND NOT EXISTS (
       SELECT 1 FROM deal_vehicles dv
        WHERE dv.vehicle_id = d.vehicle_id
          AND dv.unlinked_at IS NULL
     );

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RAISE NOTICE 'OK: % legacy attachment(s) copied into deal_vehicles.', inserted;
END $$;

COMMIT;


-- ── STEP 4. Confirm ──────────────────────────────────────────────────────────
-- Every legacy attachment should now have a matching active link.
SELECT
  (SELECT count(*) FROM deals
    WHERE vehicle_id IS NOT NULL AND archived = false)            AS legacy_attachments,
  (SELECT count(*) FROM deal_vehicles WHERE unlinked_at IS NULL)  AS active_links,
  (SELECT count(*) FROM deals d
    WHERE d.vehicle_id IS NOT NULL AND d.archived = false
      AND NOT EXISTS (SELECT 1 FROM deal_vehicles dv
                       WHERE dv.deal_id = d.id AND dv.vehicle_id = d.vehicle_id))
                                                                  AS still_missing;
-- `still_missing` should be 0. `active_links` may legitimately exceed
-- `legacy_attachments` if vehicles were attached through the new flow already.
