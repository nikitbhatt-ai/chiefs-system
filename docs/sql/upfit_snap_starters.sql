-- Vehicle Configurator: snap points + starter layouts (2026-09-30).
-- Run once in Neon's SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS upfit_snap_points (
  body_style text PRIMARY KEY,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upfit_starters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body_style text NOT NULL,
  name text NOT NULL,
  pins jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS upfit_starters_body_style_idx ON upfit_starters (body_style);
