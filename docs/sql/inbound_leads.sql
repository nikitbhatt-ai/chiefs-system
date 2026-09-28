-- Shopify lead intake — quarantine table for public storefront forms.
--
-- Run in Neon's SQL Editor. Safe to re-run (IF NOT EXISTS throughout).
-- Creates ONE new table and its three indexes; touches no existing table.
-- Schema mirrors src/db/schema.ts :: inboundLeads.

CREATE TABLE IF NOT EXISTS inbound_leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel   text NOT NULL,
  name             text NOT NULL,
  email            text NOT NULL,
  phone            text,
  agency           text,
  position         text,
  subject          text,
  message          text,
  quantity         integer,
  topic            text,
  part_number      text,
  vehicle_fitment  text,
  install_needed   text,
  vehicle_type     text,
  upfit_needed     text,
  timeline         text,
  purchase_method  text,
  product_title    text,
  product_id       text,
  product_handle   text,
  variant_id       text,
  page_url         text,
  ip_hash          text,
  user_agent       text,
  raw_payload      jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'new',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_leads_created_idx
  ON inbound_leads (created_at);
CREATE INDEX IF NOT EXISTS inbound_leads_email_idx
  ON inbound_leads (email);
-- Used by the rate limiter — keep this one.
CREATE INDEX IF NOT EXISTS inbound_leads_ip_recent_idx
  ON inbound_leads (ip_hash, created_at);
