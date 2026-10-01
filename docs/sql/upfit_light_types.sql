-- Configurator light types, editable in Settings → Light types (2026-09-30).
-- Run once in Neon's SQL Editor. Safe to re-run: the table is created only if
-- missing and the built-in list is added only where its key isn't there yet.

CREATE TABLE IF NOT EXISTS upfit_light_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  dims text,
  "group" text NOT NULL DEFAULT 'lights',
  shape text NOT NULL DEFAULT 'rect',
  size text NOT NULL DEFAULT 'medium',
  sort_order integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Start from the list the configurator already ships with.
INSERT INTO upfit_light_types (key, label, dims, "group", shape, size, sort_order) VALUES
  ('lightbar', 'Lightbar', '54 × 3.5 in', 'lights', 'rect', 'strip_large', 10),
  ('legacy_lightbar', 'Legacy Lightbar', NULL, 'lights', 'rect', 'strip_large', 15),
  ('interior_lightbar', 'Interior Lightbar', '44 × 2 in', 'lights', 'rect', 'strip_medium', 20),
  ('mega_tion', 'Mega T-Ion', '11 × 1.4 in', 'lights', 'rect', 'large', 30),
  ('tion', 'T-Ion', '5.14 × 1.49 in', 'lights', 'rect', 'medium', 40),
  ('mini_tion', 'Mini T-Ion', '4.16 × 0.91 in', 'lights', 'rect', 'small', 50),
  ('ion', 'Ion', '4 × 1 in', 'lights', 'rect', 'small', 60),
  ('hideaway', 'Hideaway', '1.3 × 1.3 in', 'lights', 'circle', 'small', 70),
  ('grille', 'Grille Light', '4 × 1.5 in', 'lights', 'rect', 'medium', 80),
  ('dash', 'Dash Light', '6 × 1.5 in', 'lights', 'rect', 'medium', 90),
  ('other', 'Other', '3 × 3 in', 'lights', 'rect', 'medium', 100),
  ('fst', 'FST', NULL, 'lights', 'rect', 'strip_small', 110),
  ('push_bumper', 'Push Bumper', '46 × 26 in', 'accessories', 'pushbar', 'large', 120),
  ('push_bumper_wrap', 'Push Bumper (full wrap)', '46 × 26 in', 'accessories', 'pushbar_wrap', 'large', 130)
ON CONFLICT (key) DO NOTHING;
