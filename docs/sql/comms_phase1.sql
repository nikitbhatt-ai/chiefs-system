-- ============================================================================
-- Comms Module — Phase 1: Shared Team Calendar
-- Run this in Neon's SQL Editor (the project applies schema changes by hand;
-- we do NOT run drizzle-kit migrate/push — see CLAUDE.md).
--
-- Safe to run more than once: the enum creation is guarded, tables use
-- CREATE TABLE IF NOT EXISTS, indexes use IF NOT EXISTS, and the check /
-- foreign-key constraints are added only if absent.
-- ============================================================================

-- ── Enum ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE calendar_event_type AS ENUM
    ('service','upfit','offsite','delivery','customer_meeting','announcement','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── calendar_events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  event_type    calendar_event_type NOT NULL,
  starts_at     timestamp NOT NULL,
  ends_at       timestamp NOT NULL,
  all_day       boolean NOT NULL DEFAULT false,
  location      text,
  customer_id   uuid REFERENCES customers(id),
  deal_id       uuid REFERENCES deals(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  -- 'team' = everyone; 'selected' = invitees + creator + admin/manager only.
  visibility    text NOT NULL DEFAULT 'team',
  created_by    uuid NOT NULL REFERENCES users(id),
  cancelled_at  timestamp,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

-- An event cannot end before it starts.
DO $$ BEGIN
  ALTER TABLE calendar_events
    ADD CONSTRAINT calendar_events_end_after_start CHECK (ends_at >= starts_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS calendar_events_starts_at_idx  ON calendar_events (starts_at);
CREATE INDEX IF NOT EXISTS calendar_events_created_by_idx ON calendar_events (created_by);
CREATE INDEX IF NOT EXISTS calendar_events_work_order_idx ON calendar_events (work_order_id);

-- ── calendar_event_attendees ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_event_attendees (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'invited' | 'accepted' | 'declined' — an attendee may change only their own.
  response   text NOT NULL DEFAULT 'invited',
  created_at timestamp NOT NULL DEFAULT now()
);

-- One attendee row per (event, user).
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_attendees_event_user_uidx
  ON calendar_event_attendees (event_id, user_id);
CREATE INDEX IF NOT EXISTS calendar_event_attendees_user_idx
  ON calendar_event_attendees (user_id);
