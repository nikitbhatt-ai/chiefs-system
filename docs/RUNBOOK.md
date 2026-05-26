# Operations runbook — Chiefs Pursuit Surplus ERP/CRM

Practical guide for keeping the system running, debugging issues, restoring
from backup, and onboarding new teammates. Pair with `docs/REQUIREMENTS.md`
(running feature spec).

## Production URLs

- App: `https://chiefs-system.vercel.app` (or your custom domain in Vercel → Settings → Domains).
- Sign-in: `/signin`. Middleware redirects unauthenticated requests there from any path.
- Universal lead-capture endpoint: `POST /api/leads/capture`.
- Cron endpoint: `GET /api/cron/expiring-credentials` (daily 13:00 UTC).

## Required environment variables on Vercel

Set under Vercel → Project → Settings → Environment Variables. Production + Preview unless noted.

| Name | Purpose | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Neon Postgres connection string | Required. Pooler URL recommended. |
| `AUTH_SECRET` | NextAuth session signing | Required. Generate via `openssl rand -hex 32`. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage for uploads | Required. Auto-provisioned when you add Vercel Blob. |
| `CRON_SECRET` | Authorizes the daily cron endpoint | Required if you want credential-expiration alerts. |
| `LEAD_CAPTURE_SECRET` | Authorizes `POST /api/leads/capture` | Endpoint 401s when unset. Set before pointing real sources. |
| `PDF_COMPANY_NAME` | Brand name on generated PDFs | Optional; falls back to "Chiefs Pursuit Surplus". |
| `PDF_COMPANY_TAGLINE` | Brand line on PDFs | Optional. |
| `PDF_COMPANY_ADDRESS` | Address on PDFs | Optional. |
| `PDF_COMPANY_PHONE` | Phone on PDFs | Optional. |
| `PDF_COMPANY_EMAIL` | Email on PDFs | Optional. |
| `PDF_COMPANY_WEBSITE` | Website on PDFs | Optional. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Microsoft 365 SSO | Optional. Only if enabling SSO login. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Microsoft 365 SSO | Pair with the above. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Microsoft 365 SSO | Pair with the above. |
| `EMAIL_SERVER_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_FROM` | Magic-link email login | Optional. Set the full block to enable. |

After changing any env var, **redeploy** (Vercel → Deployments → ⋯ → Redeploy) so the new value takes effect.

## Onboarding a new teammate

1. Sign in as an `admin` user.
2. Open `/users`.
3. Fill **Name**, **Email**, **Role**, and **Initial password** (8+ chars).
4. Click **Create user**.
5. Send the teammate the URL + their email + the initial password (Slack / email / phone — out of band from this app).
6. They sign in at `/signin`, can change their password from `/users/[id]/edit` on their own row.

Roles drive the dashboard view + RBAC. See `src/lib/customerDocuments.ts → CATEGORY_ROLE_ACCESS` for the per-category access map.

## Database backups + restore

### Neon point-in-time restore

Neon includes PITR out of the box. Console → your project → **Restore** tab. Pick a point in time within your retention window (depends on Neon plan; check console for current setting) and restore into either the same branch (destructive) or a new branch (safe — get a parallel DB you can validate before swapping).

### Manual `pg_dump` weekly (recommended belt-and-suspenders)

Run from your local machine or a GitHub Actions cron:

```bash
# Replace with the Neon connection string from Vercel env vars.
# Use the DIRECT URL (not the pooled one) for pg_dump.
export DATABASE_URL='postgresql://USER:PASS@HOST/dbname?sslmode=require'

DATE=$(date +%Y-%m-%d)
pg_dump "$DATABASE_URL" --no-owner --no-acl --format=custom --file="chiefs-system-$DATE.dump"

# Optional: push to S3 / Backblaze / iCloud / wherever.
```

To restore one of those dumps later:

```bash
pg_restore --no-owner --no-acl --clean --if-exists --dbname="$DATABASE_URL" chiefs-system-2026-05-19.dump
```

GitHub Actions cron version (commit to `.github/workflows/db-backup.yml`):

```yaml
name: nightly-db-backup
on:
  schedule:
    - cron: "0 7 * * *"   # daily 07:00 UTC
  workflow_dispatch:
jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - run: |
          sudo apt-get update && sudo apt-get install -y postgresql-client
          DATE=$(date +%Y-%m-%d)
          pg_dump "${{ secrets.NEON_DIRECT_URL }}" --no-owner --no-acl --format=custom --file="$DATE.dump"
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - run: aws s3 cp *.dump s3://chiefs-system-backups/
```

## Schema migration runbook

All schema changes have been applied via SQL run manually in Neon's SQL Editor. If you ever stand up a fresh database, run the cumulative block below in order. Every statement uses `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` so it's safe to re-run.

```sql
-- PR 1: pipeline templates
ALTER TYPE customer_type ADD VALUE IF NOT EXISTS 'walk_in_credentialed';
ALTER TYPE deal_stage ADD VALUE IF NOT EXISTS 'credential_verification';
ALTER TYPE deal_stage ADD VALUE IF NOT EXISTS 'deposit_received';

-- PR 2: restricted parts
ALTER TABLE parts ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS restriction_category text;

-- PR 4: pipeline-doc kind column on files
ALTER TABLE files ADD COLUMN IF NOT EXISTS kind text;
CREATE INDEX IF NOT EXISTS files_kind_idx ON files (kind);

-- PR 15: notifications + activity mentions
ALTER TABLE deal_activity ADD COLUMN IF NOT EXISTS mentions jsonb DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id, read_at);

-- PR 16: CRM ↔ Workflow sync foundation
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS work_orders_deal_idx ON work_orders (deal_id);
CREATE TABLE IF NOT EXISTS stage_mapping (
  crm_stage text PRIMARY KEY,
  workflow_stage text,
  sort_order int NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO stage_mapping (crm_stage, workflow_stage, sort_order) VALUES
  ('prospect', NULL, 10),
  ('credential_verification', NULL, 20),
  ('quote_sent', 'estimate', 30),
  ('po_received', 'confirmed', 40),
  ('deposit_received', 'confirmed', 50),
  ('in_production', 'in_progress', 60),
  ('delivered', 'delivered', 70),
  ('lost', 'archived', 80)
ON CONFLICT (crm_stage) DO NOTHING;

-- PR 17: stage override audit
CREATE TABLE IF NOT EXISTS stage_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind text NOT NULL,
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  reason text NOT NULL,
  user_id uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stage_overrides_deal_idx ON stage_overrides (deal_id);

-- PR 19: procurement / lead times
ALTER TABLE parts ADD COLUMN IF NOT EXISTS lead_time_days int NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS target_build_start_date timestamp;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS safety_buffer_days int NOT NULL DEFAULT 7;

-- PR 20: customer folder RBAC + audit + cred expiration
ALTER TABLE deal_credentials ADD COLUMN IF NOT EXISTS expiration_notified_at timestamp;
CREATE TABLE IF NOT EXISTS document_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES customer_documents(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  ip_address text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_audit_log_customer_idx ON document_audit_log (customer_id);
CREATE INDEX IF NOT EXISTS document_audit_log_document_idx ON document_audit_log (document_id);

-- PR 21: PDF audit
CREATE TABLE IF NOT EXISTS pdf_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  template text NOT NULL,
  purpose text NOT NULL,
  user_id uuid REFERENCES users(id),
  recipient text,
  ip_address text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pdf_audit_log_record_idx ON pdf_audit_log (record_type, record_id);
CREATE INDEX IF NOT EXISTS pdf_audit_log_user_idx ON pdf_audit_log (user_id);

-- PR 26: parts_consumed flag on work_orders (was on the schema but missing in DB)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS parts_consumed boolean NOT NULL DEFAULT false;
```

## Sandbox / smoke test walkthrough

Walk one fake deal through every system before mass team testing.

1. **Create a sandbox customer**: `/crm` → +New customer → "Sandbox City Police" (type = government).
2. **Create a lead**: `/leads` → +New lead → name "Sandbox Lead" / customerType government / source = Sales Call / sub_source = your-name.
3. **Convert to deal**: lead row → Convert → confirm deal lands in `/deals`.
4. **Open the pipeline**: `/pipeline` → click the new deal card → "+ Create quote" → adds a draft quote tied to the deal.
5. **Build the quote**: add 2-3 line items from inventory, set qty/price/discount, save.
6. **Test status flow**: flip status Draft → Sent → Approved → Converted; confirm header status updates and the dropdown reflects current state.
7. **Move the deal through pipeline**: drag from Lead → Proposal → Won bucket. Confirm:
   - The Workflow Kanban (`/workflow`) shows the linked quote in Confirmed Builds.
   - The deal page shows a "Workflow Status" badge.
   - Sales notifications fire.
8. **Move the build on `/workflow`**: drag Confirmed → Awaiting Parts → In Progress (parts auto-deduct from inventory) → QC → Completed → Delivered. Confirm the CRM stage badge follows.
9. **Generate a PDF**: from the quote page click "Download PDF" then "Download invoice PDF" (after converted). Confirm both download cleanly.
10. **Customer folder**: navigate to the sandbox customer's `/crm/[id]` page. Confirm the auto-linked quote / invoice appears under Quotes & Estimates / Invoices.
11. **Procurement**: set a target build start date on the WO; check `/procurement/parts-to-order` reflects part lead times.
12. **Lead capture**: with `LEAD_CAPTURE_SECRET` set, run the curl example from `docs/REQUIREMENTS.md` "Universal lead-capture API" section. Confirm a new lead appears on `/leads`.
13. **Cleanup**: delete sandbox records OR leave them in place as a known reference data set for new teammates.

## Debugging common failure modes

### "Stage move failed" or "Application error: server-side exception"

Almost always a missing column or table in Neon vs. what `src/db/schema.ts` declares. Drizzle's `SELECT *` lists every column it knows about; missing columns throw "column 'X' does not exist".

1. Open Vercel → Project → Logs → filter the failing function (e.g. `/api/quotes/[id]/workflow-stage`).
2. Look for `column "X" does not exist` or `relation "Y" does not exist`.
3. Find the matching `ALTER TABLE` / `CREATE TABLE` in the cumulative SQL block above, run it in Neon.

### Notifications not firing

Either `notifications` table missing (re-run PR 15 SQL) or no active users with the target role exist. Check `select count(*) from users where active = true and role = 'sales';` for sales notifications.

### Cron not running

Vercel Cron only fires on **production deployments**. Confirm `vercel.json` is present in main and `CRON_SECRET` is set. Force a trigger by hitting `/api/cron/expiring-credentials` with `Authorization: Bearer $CRON_SECRET`.

### PDF download returns 500

React-PDF requires the Node runtime. If you see `Edge runtime` errors in the Vercel log, confirm `export const runtime = "nodejs"` is present in the affected route file.

## Roles + RBAC quick reference

| Role | Default dashboard | Notable access |
| --- | --- | --- |
| `admin` | Admin (switchable) | Everything, including `/users`, `/settings/*`. |
| `manager` | Admin (switchable) | Same as admin minus user management. |
| `accountant` | Admin (switchable) | Sees Invoices + financial docs. |
| `sales` | Sales (locked) | Quotes, POs, Correspondence, Repeat-customer docs. |
| `warehouse` | Operations (locked) | Spec approvals, Photos / Build docs. |
| `tech` | Operations (locked) | Spec approvals, Photos / Build docs. |

Contracts / Credentials / Compliance are always manager+ only. Restricted-doc enforcement runs in `/api/customer-documents/[id]/download` so direct blob links don't bypass it.

## Useful URLs (admin)

- `/users` — create / edit / disable team members
- `/settings/lookups` — sources, sub-sources, trade shows, social platforms, credential types, departments
- `/settings/sla` — stage SLA windows (used by the "stalled deals" Sales dashboard panel)
- `/settings/stage-mapping` — CRM stage → Workflow stage routing
- `/reporting` — index of reports (vendor lead-time variance today)
- `/procurement` — lead-time + parts-to-order overview
- `/notifications` — your inbox, mark-read, delete

## Where things live in the codebase

```
src/
├─ app/
│  ├─ page.tsx                 → role-routed dashboard
│  ├─ pipeline/                → /pipeline Kanban
│  ├─ workflow/                → /workflow shop board
│  ├─ deals/, leads/, crm/, quotes/, purchase-orders/, work-orders/, inventory/
│  ├─ procurement/, reporting/, settings/
│  └─ api/                     → REST + cron + lead capture
├─ components/
│  ├─ AppShell.tsx             → layout + notifications bell
│  ├─ TopNav.tsx               → grouped nav
│  └─ dashboard/               → KpiCard + Sales/Ops/Admin dashboards
├─ db/
│  └─ schema.ts                → single source of truth for tables
├─ lib/
│  ├─ pipelines.ts             → 3 pipelines + canAdvanceTo guardrails
│  ├─ pipelineBuckets.ts       → 7-bucket Kanban map
│  ├─ stageMapping.ts          → CRM ↔ Workflow stage map + defaults
│  ├─ dealTriggers.ts          → maybePromoteWonDeal / syncDealToWorkflow / syncWorkflowToDeal
│  ├─ notifications.ts         → notify() / notifyMany()
│  ├─ customerDocuments.ts     → category map + CATEGORY_ROLE_ACCESS
│  ├─ procurement.ts           → lead-time math + variance rollup
│  ├─ pdf/                     → @react-pdf/renderer service + templates
│  └─ dashboard/metrics.ts     → server-side KPI resolvers
└─ middleware.ts               → auth gate
```
