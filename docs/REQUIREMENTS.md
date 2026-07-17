# Feature Requirements

This is the running spec of what each module needs. Consult this document
whenever building or extending a feature. Items marked ✅ are done; others
are pending and should be addressed when their owning module is built.

## Role-based dashboards (PR 25, Phase 1)

Landing page (`/`) routes to one of three dashboard views based on
`session.user.role`. Admin / manager / accountant default to Admin
and can switch views via `?view=sales|operations|admin`; everyone
else is locked to the default for their role.

Default mapping:
- `admin`, `manager`, `accountant` → Admin
- `sales` → Sales
- `warehouse`, `tech` → Operations

Each view follows the spec layout: top-row KPIs (6 cards), action
items row, and the shared "My open tasks" panel at the bottom.
Charts, drill-through links, customization, polling, and
industry-specific deep-dives are deferred to Phase 2+.

### KPIs (with proxies where data isn't tracked yet)

| View | Cards |
| --- | --- |
| Sales | Open Deals · Pipeline Value · Closed This Month · Revenue This Month (proxy: converted quotes) · Win Rate (90d) · Avg Deal Cycle |
| Operations | Active Builds · Scheduled This Week · Ready for Delivery · Avg Build Days (90d) · On-Time % (proxy: target+30d) · Past Due |
| Admin | Monthly Revenue (proxy: converted quotes) · Monthly Expenses (proxy: received POs) · Net Profit · Outstanding Receivables (proxy: open won-bucket deals) · Avg Days to Payment (proxy: lead→won) · Avg Time Per Upfit |

Proxy badges (`hint=` on the card) tell the user the metric is an
approximation until invoicing / payment / delivery-date columns
land.

### Action items

| View | Panels |
| --- | --- |
| Sales | Stalled deals (assigned to me, >14d in stage) · Quotes awaiting response (sent, >5d) · Tasks due today |
| Operations | Builds awaiting parts · POs arriving this week · QC pending · Late vendor deliveries |
| Admin | Invoices past due (proxy: converted quotes >30d, deal not delivered) · Large open deals (top 5 by latest-quote value) · Expiring credentials (next 60d) · Inactive customers (delivered but no activity in 6mo) |

Every item links to the underlying entity page.

### Implementation

- `src/lib/dashboard/metrics.ts` — server-side resolvers, one
  function per (view, section). Pure, no caching layer yet — the
  spec's TTL caching is Phase 2.
- `src/components/dashboard/KpiCard.tsx` — reusable metric card,
  optional `href` makes the whole card clickable.
- `src/components/dashboard/{Sales,Operations,Admin}Dashboard.tsx`
  — server components that render their view's KPI row + action
  items.
- `src/app/page.tsx` picks the view from role + `?view=` and
  renders the matching component, then renders the shared "My
  open tasks" panel below it.

### Deferred (post PR 25)

- **Charts / visualizations** (Phase 3) — pipeline funnel, build
  status distribution, revenue trend, etc. Will pull a charting
  dep like recharts when we get there.
- **Industry-specific deep-dives** (Phase 4) — gov fiscal year
  pipeline, cooperative contract utilization, vehicle storage
  aging, build estimation accuracy, top customers / vendors,
  CLV/CAC.
- **Customization** (Phase 5) — hide / reorder cards, per-user
  preferences in `user_dashboard_preferences`.
- **Polling refresh** (60-90s) + cache TTLs per spec.
- **Activity feed** per role (live event stream).

## Cross-cutting requirements (apply to every module)

- [x] **Top navigation** grouped into 5 tabs: Dashboard, Workflow, CRM
      (Customers, Leads, Quotes), Operations (Work Orders, Vehicles,
      Inventory, Purchase Orders, Vendors), Admin (Timeclock, Reporting,
      Users). Click-to-open dropdowns; the active parent tab is highlighted.
- [x] **Breadcrumbs** under the header reflect section + parent group +
      current page on every AppShell page.
- [x] **Global search** in the header — `/api/search?q=` returns up to 5
      hits per group across customers, leads, quotes, work orders. Results
      open in a dropdown grouped by entity type.
- [ ] **Edit anywhere**: every entity must have an Edit page (`/{section}/[id]/edit`).
      ✅ done for: customers, vendors, leads.
- [ ] **Filter by column** on every list view (customers, leads, work orders,
      inventory, purchase orders, quotes, vehicles). Common filters: customer,
      brand/manufacturer, most recent date, status, tags.
- [ ] **Tags + archive + delete** on every list.
- [x] **Print / Save as PDF** for quotes — `/quotes/[id]/print` renders
      a clean Times New Roman 12pt document; browser handles print +
      Save-as-PDF. Pattern to be reused for invoices, work orders,
      reports, inventory exports.
- [ ] **Logo on branded PDFs** — pending logo file upload to `public/`.
- [~] **Server-side PDF generation** via `@react-pdf/renderer` (PR 21,
      Phase 1). Centralized service at `src/lib/pdf/` with shared
      branding + styles, a `registry.ts` mapping `record_type` →
      `(data resolver, React-PDF document)`, templates for Quote /
      Invoice / Purchase Order, and an `audit.ts` helper that writes
      to the new `pdf_audit_log` table. API endpoints
      `GET /api/pdf/quotes/[id]` (with `?variant=invoice`) and
      `GET /api/pdf/purchase-orders/[id]` stream the PDF buffer with
      a sensible `Content-Disposition`. Phase 2+ (work orders, spec
      sheets, change orders, receipts, deal summaries, customer
      dossier, bulk export, watermarks, email auto-attach,
      versioning snapshots, admin template editor) is deferred.
- [ ] **Send-to-customer** is separate from Print — takes an email input
      and emails the PDF for approval.
- [x] **CSV/Excel mass import** where useful — parts inventory
      (`/inventory/import`) and packages (`/packages/import`) both shipped.

## Universal PDF export (PR 21, Phase 1)

System-wide PDF generation registered through one service. Phase 1
covers Quote (with Invoice variant) and Purchase Order. New record
types added later just register a `(resolver, renderer)` pair in
`src/lib/pdf/registry.ts` to inherit endpoint + audit + download UI.

- [x] **Service** `src/lib/pdf/`:
  - `branding.ts` reads company name / tagline / address / phone /
    email / website / colors from `PDF_COMPANY_*` env vars (falls
    back to defaults). Moves to admin settings in a later PR.
  - `styles.ts` shared React-PDF `StyleSheet` for page chrome,
    header, sections, table, totals, footer, and watermark.
  - `templates/quote.tsx` renders Quote OR Invoice variant from
    the same data shape; line-item table, totals breakdown, notes,
    DRAFT watermark when `status='draft'`. Footer carries
    page numbers + generation timestamp.
  - `templates/purchaseOrder.tsx` mirrors the quote template for
    vendor-side POs; `RECEIVED` watermark when fully received.
  - `registry.ts` exports `renderRecordPdf(recordType, recordId)`
    returning `{ buffer, fileName, template }`. Filename
    convention `Quote_<num>_<YYYYMMDD>.pdf`, etc.
  - `audit.ts` writes a `pdf_audit_log` row per generation with
    `(record_type, record_id, template, purpose, user_id,
    recipient, ip_address, created_at)`.
- [x] **API endpoints** (Node runtime — React-PDF needs it):
  - `GET /api/pdf/quotes/[id]` — quote PDF, accepts
    `?variant=invoice` to flip the document title + footer
    wording (no separate invoice table; converted quotes are
    invoices).
  - `GET /api/pdf/purchase-orders/[id]` — PO PDF.
  - Both check session, log to `pdf_audit_log` with `purpose =
    download`, then stream `application/pdf` with
    `Content-Disposition: attachment; filename=…`.
- [x] **Download buttons**:
  - `/quotes/[id]` action bar: Download PDF, Download invoice
    PDF (visible only when `status=converted`), Open print view.
  - `/purchase-orders/[id]` action bar: Download PDF.
- [x] **RBAC**: inherits page-level auth check; restricted-doc
  enforcement on customer-folder downloads stays in
  `/api/customer-documents/[id]/download`.

### Schema additions (PR 21)

```sql
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
```

Optional env vars to customize branding without code changes:
`PDF_COMPANY_NAME`, `PDF_COMPANY_TAGLINE`, `PDF_COMPANY_ADDRESS`,
`PDF_COMPANY_PHONE`, `PDF_COMPANY_EMAIL`, `PDF_COMPANY_WEBSITE`.

### Deferred (post PR 21)

- **Auto-storage** into `customer_documents` on quote convert +
  PO create (Phase 2 of the spec).
- **Versioning snapshots** — immutable file with versioned name
  per generation (Phase 5).
- **Email auto-attach** workflow + Send-to-customer button
  (Phase 2).
- **Bulk export** (Phase 4): zip of all customer docs, all
  invoices in a date range, customer dossier with TOC.
- **Watermarks**: DRAFT/VOID/PAID/PAST DUE/CONFIDENTIAL beyond
  the two already present, plus user-watermark for sensitive
  exports (Phase 5).
- **Admin template editor** — moves branding + templates to a
  DB-backed `pdf_templates` table editable via
  `/settings/pdf-templates`.
- **Additional record types**: Work Order, Spec Sheet, Change
  Order, Deal Summary, Payment Receipt, Credential Record,
  Partner Referral Summary, Reports, Audit Logs, Activity Feed.

## Customers (CRM)

- [x] List, add, edit, delete (basic CRUD).
- [ ] Show deal stage on each list row.
- [ ] Show assigned sales associate (dropdown of users).
- [ ] Change stage inline from list view.
- [ ] Internal notes section per customer.
- [ ] Customer entity page = full history: all deals, quotes, invoices,
      communications, upfit configs, build packages — all tied to one folder.
- [ ] Folders in CRM sidebar for grouping accounts.
- [ ] Quote builder lives inside the deal (see Quotes section).
- [ ] Upfit builder accessible from the customer entity (see Upfit section).

## Leads

- [x] List, add, edit, delete, convert-to-customer.
- [ ] Filters + tags + archive (cross-cutting).
- [ ] Internal notes.

### Universal lead-capture API (PR 34, Phase 1)

`POST /api/leads/capture` is the single endpoint every external
source (Shopify webhook, main-site contact form, trade-show iPad,
chatbot, SMS opt-in service, …) calls to drop a new lead into the
CRM. Any new source plugs in by hitting the same URL with the
shared body shape — no per-source code path.

- **Auth**: shared secret in `LEAD_CAPTURE_SECRET` env var, sent
  as `Authorization: Bearer <secret>` OR `X-Webhook-Secret:
  <secret>`. If the env var is unset, the endpoint always 401s
  (avoids accidental open endpoint in dev).
- **Body** (all optional except `source` + `name`):
  ```json
  {
    "source": "shopify",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "555-1212",
    "customerType": "government" | "walk_in_credentialed" | "commercial" | "retail",
    "subSource": "lightbar inquiry",
    "notes": "Wants pricing on 12 patrol upfits.",
    "metadata": { /* any JSON; merged into leads.sub_source_meta */ }
  }
  ```
- **Behavior**: inserts a `leads` row with `status='new'`. Stamps
  `sub_source_meta` with the request's metadata plus capture
  timestamp, IP, and user-agent for traceability. Best-effort
  notification to every active `role='sales'` user.
- **Response**: `201 { ok: true, id }` on success, `401` on bad
  secret, `400` on invalid payload.

### Required env var

`LEAD_CAPTURE_SECRET` — generate with `openssl rand -hex 32` and
set on Vercel (Production + Preview). Used as the shared secret.

### Deferred (next PRs)

- **Real-time lead arrival on /leads** (polling or SSE so the
  list refreshes without a page reload).
- **Per-source API keys** + admin page to revoke individual
  channels without rotating the global secret.
- **Communication threads** (email ingest via Resend, SMS via
  Twilio, unified chronological view) — Capability 2.
- **Full real-time** (WebSockets via Pusher, presence
  indicators, browser push, multi-channel notifications) —
  Capability 3.


## Pipeline templates (in progress, phased)

Three pipeline templates drive how a deal flows from prospect to delivered.
Pipeline is chosen at lead creation via the Customer Type / pipeline
dropdown on `/leads` and carries through to the deal on conversion. Stage
transitions are validated server-side: stages must advance one step at a
time within the pipeline's stage list, backwards is allowed, and `lost`
is reachable from anywhere.

- [x] **Pipeline engine** — `src/lib/pipelines.ts` defines the three
      pipelines (slug, label, ordered stages, procurement gate, hard
      gate). `pipelineForCustomerType()` maps `customers.type` to a
      pipeline slug. `canAdvanceTo()` validates transitions.
- [x] **Government pipeline**: prospect → quote_sent → po_received →
      in_production → delivered. PO Received is the procurement gate.
- [x] **Walk-In Credentialed pipeline**: prospect →
      credential_verification → quote_sent → deposit_received →
      in_production → delivered. Credential Verification is a hard gate.
- [x] **Commercial pipeline**: prospect → quote_sent → deposit_received
      → in_production → delivered. Simpler deposit-based flow.
- [x] **Lead → deal conversion** carries `customerType` to
      `customers.type` and `deals.pipeline`, and creates the deal row.
- [x] **Pipeline progression strip** on the deal entity page shows the
      ordered stages with current position.
- [x] **Credential gate enforcement** (PR 2): `canAdvanceTo` accepts a
      `hasActiveCredential` context; for pipelines with `hardGate`, the
      gate blocks advancement past that stage unless at least one
      credential is verified and not expired. Credentials panel on the
      deal entity page (walk-in only) supports add / verify / delete
      and shows status badges: `Verified`, `Pending verification`,
      `Expiring soon` (≤30 days), `Expired`.
- [x] **Restricted equipment flagging** (PR 2): `parts.restricted` +
      `parts.restriction_category` columns; restricted-equipment
      toggle on the part edit form; restricted badge on the inventory
      list. Each credential carries a `restricted_equipment` jsonb
      array of category slugs it covers. `credentialCoversPart()` in
      `src/lib/credentials.ts` is the canonical check used by quote /
      work-order flows.
- [x] **Quote restricted-part block** (PR 3): `saveQuote` rejects on
      save if the linked deal has `pipeline = walk_in_credentialed`
      and any restricted part on the quote lacks credential coverage.
      Error message names the offending parts. Restricted parts also
      surface as a red badge in the quote-editor part-autocomplete
      dropdown.
- [ ] **Work-order restricted-part block** (later): same check in the
      work-order flow when bypassing the quote.
- [x] **Parallel tracks system** (PR 3): Sales / Credential / Build
      tracks render stacked on the deal entity page with per-track
      stages, current-stage highlighting, and past/future styling.
      Credential track only appears for pipelines with a hard gate.
      Build track sources its current stage from the latest quote's
      `workflowStage` (or "not started" if no quote yet).
- [x] **Per-pipeline document templates** (PR 4, softened in PR 14):
      three docs defined in `src/lib/documentTemplates.ts` — Government
      PO Intake, Walk-In Credential Intake, Commercial Deposit Receipt.
      Each has a generate (print-friendly HTML at
      `/deals/[id]/documents/[kind]/print`) and upload action on the
      deal page's Documents panel. Uploaded copies go to Vercel Blob
      and land in `customer_documents` with
      `kind = pipeline_doc:<slug>`. Originally a hard `canAdvanceTo`
      gate; in PR 14 this became a **soft reminder**: when the deal
      crosses into the doc's required-by stage without it attached,
      `maybeCreateDocReminder` drops an open task on the deal
      (assigned to the deal's assignee, department=sales) instead of
      blocking the move. Deduped so re-saves don't spam.

### Schema additions (PR 1)

Add new enum values via Neon's SQL Editor before deploying this PR:

```sql
ALTER TYPE customer_type ADD VALUE IF NOT EXISTS 'walk_in_credentialed';
ALTER TYPE deal_stage ADD VALUE IF NOT EXISTS 'credential_verification';
ALTER TYPE deal_stage ADD VALUE IF NOT EXISTS 'deposit_received';
```

Run each statement in its own transaction (Postgres won't allow the new
enum value to be used in the same transaction it's added).

### Schema additions (PR 2)

```sql
ALTER TABLE parts ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS restriction_category text;
```

### Schema additions (PR 4)

```sql
ALTER TABLE files ADD COLUMN IF NOT EXISTS kind text;
CREATE INDEX IF NOT EXISTS files_kind_idx ON files (kind);
```

Also requires the `BLOB_READ_WRITE_TOKEN` env var on Vercel (already
present for any project that uses Vercel Blob — confirm in
Settings → Environment Variables).

## Customer file / folder system

Plain-language: every customer (Dallas County, etc.) has one folder holding
every quote, PO, contract, credential, spec approval, photo, etc. Anyone on
the team can pull up the full history in seconds.

- [x] **`customer_documents` table** (PR 8, replaces the old `files` table).
      Columns: `id`, `customer_id` (FK, cascade), `category`, `file_name`,
      `blob_url`, `mime_type`, `size_bytes`, `uploaded_by`, `uploaded_at`,
      `associated_deal_id` (FK, set null), `tags` (jsonb), `notes`, `kind`
      (legacy pipeline-doc slug), `version`, `is_current_version`,
      `parent_document_id`.
- [x] **10 folder categories** defined in
      `src/lib/customerDocuments.ts`: Quotes & Estimates, Purchase Orders,
      Contracts & Agreements, Credentials & Certifications, Spec Approvals
      (Signed), Invoices, Correspondence, Photos / Build Documentation,
      Compliance Documents, Miscellaneous.
- [x] **Pipeline-doc routing**: PR 4 pipeline documents now write to
      `customer_documents` with the matching category — government PO
      intake → Purchase Orders, walk-in credential intake → Credentials &
      Certifications, commercial deposit receipt → Contracts & Agreements.
      The pipeline-doc stage gate (PR 4) keys off `kind` on
      `customer_documents`, so it keeps working transparently.
- [x] **Folder view on `/crm/[id]`** with collapsible category sections,
      direct upload form (file + category + associated deal + notes),
      filter bar (filename, category, date range), per-file delete and
      open-in-new-tab download.
- [x] **Versioning**: uploading a file whose name matches an existing
      current-version doc in the same customer + category increments
      `version`, sets `is_current_version = false` on the prior row, and
      points the new row's `parent_document_id` at the lineage root.
- [x] **Auto-link generated quotes / invoices** to the customer folder
      (PR 9): every quote with a `customer_id` gets one stable
      `customer_documents` row keyed by
      `kind = auto_link:quote:<quoteId>`. The row's category is
      `quotes_estimates` while the quote is draft/sent/approved and
      flips to `invoices` when `status = converted`. `blob_url` points
      at the live `/quotes/[id]/print` view; `file_name` tracks the
      quote number. Upserted on create, on save, and on status change;
      deleted on quote delete or when the customer is unset.
- [ ] **Auto-link purchase orders & spec sheets** (later). POs are
      vendor-side artifacts so they need either an inbound-PO entity
      or a manual upload flow; spec sheets need the spec UI built
      first.
- [x] **Customer summary card** (PR 10): top-right of `/crm/[id]` now
      shows Total deals, Active deals, Revenue (closed-won = converted
      quotes), and Last contact (most recent of deal update, customer
      note, document upload, deal activity). Below the card, an
      amber-bordered "Expiring credentials" banner lists any
      `deal_credentials` rows for the customer's deals bucketed by
      expiry: already expired, within 30 days, 30–60, 60–90. Each
      entry jumps to its deal. Primary contacts list deferred — no
      customer-contacts table exists yet.
- [x] **Role-based access control** (PR 20). `CATEGORY_ROLE_ACCESS` in
      `src/lib/customerDocuments.ts` maps each of the 10 categories to
      the roles that can read AND write it. Defaults from the spec:
      - sales + accountant: quotes, POs, correspondence (sales only)
      - warehouse + tech: spec_approvals, photos_build
      - accountant: invoices (also manager+)
      - manager + admin: all categories — credentials, contracts,
        invoices, compliance are manager+ only
      Enforced on the `/crm/[id]` page (`docFilters` narrowed by
      `visibleCategoriesFor(role)`; upload + search dropdowns filtered
      to allowed categories) and re-checked in both the
      `uploadCustomerDoc` and `deleteCustomerDoc` server actions so
      the server can't be bypassed by a hand-crafted POST. The
      `/api/customer-documents/[id]/download` route checks too.
- [x] **Audit log** (PR 20). New `document_audit_log` table
      `(id, document_id, customer_id, user_id, action, ip_address,
      created_at)`, indexed on customer_id + document_id. Logged on
      upload (with `action = upload` or `upload_new_version` when
      versioning kicks in), delete, and download (the new
      `/api/customer-documents/[id]/download` wrapper records the
      view + redirects to the blob URL). IP is best-effort from
      `x-forwarded-for`. Document list links go through the
      download wrapper instead of the raw blob URL so normal
      in-app usage is captured.
- [x] **Expiration alerts** (PR 20). Daily Vercel Cron at 13:00 UTC
      hits `/api/cron/expiring-credentials`. The endpoint scans
      `deal_credentials` for rows whose `expires_at` is within 30
      days (or already past), filtered by
      `expiration_notified_at IS NULL OR < now − 7 days` for dedup.
      For each hit it fires a `doc_reminder` notification to the
      deal's `assigned_to` (with credential type, customer name,
      and days remaining or "expired"), then stamps
      `expiration_notified_at` so the same row only fires once per
      week as the deadline approaches. Authorization: rejects
      anything missing `Authorization: Bearer ${CRON_SECRET}`.
      `vercel.json` registers the schedule.

### Schema additions (PR 20)

```sql
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
```

Also set `CRON_SECRET` on Vercel (Settings → Environment Variables);
Vercel attaches it as `Authorization: Bearer …` on scheduled hits.

### Schema migration (PR 8)

```sql
-- Create customer_documents (replaces files)
CREATE TABLE IF NOT EXISTS customer_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category text NOT NULL,
  file_name text NOT NULL,
  blob_url text NOT NULL,
  mime_type text,
  size_bytes integer,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamp NOT NULL DEFAULT now(),
  associated_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  tags jsonb DEFAULT '[]'::jsonb,
  notes text,
  kind text,
  version integer NOT NULL DEFAULT 1,
  is_current_version boolean NOT NULL DEFAULT true,
  parent_document_id uuid
);
CREATE INDEX IF NOT EXISTS customer_documents_customer_idx ON customer_documents (customer_id);
CREATE INDEX IF NOT EXISTS customer_documents_category_idx ON customer_documents (customer_id, category);
CREATE INDEX IF NOT EXISTS customer_documents_deal_idx ON customer_documents (associated_deal_id);
CREATE INDEX IF NOT EXISTS customer_documents_current_idx ON customer_documents (customer_id, is_current_version);
CREATE INDEX IF NOT EXISTS customer_documents_kind_idx ON customer_documents (kind);

-- Migrate any existing rows from files. entity_type='deal' rows pull the
-- customer_id from the deal; kind maps to category via the mapping in
-- src/lib/customerDocuments.ts (which is documented in this file).
INSERT INTO customer_documents
  (id, customer_id, category, file_name, blob_url, mime_type, size_bytes, uploaded_by, uploaded_at, associated_deal_id, kind)
SELECT
  f.id,
  d.customer_id,
  CASE
    WHEN f.kind = 'pipeline_doc:government_po_intake' THEN 'purchase_orders'
    WHEN f.kind = 'pipeline_doc:walk_in_credential_intake' THEN 'credentials_certifications'
    WHEN f.kind = 'pipeline_doc:commercial_deposit_receipt' THEN 'contracts_agreements'
    ELSE 'misc'
  END,
  f.filename,
  f.blob_url,
  f.mime_type,
  f.size_bytes,
  f.uploaded_by,
  f.uploaded_at,
  f.entity_id,
  f.kind
FROM files f
JOIN deals d ON d.id = f.entity_id
WHERE f.entity_type = 'deal' AND d.customer_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS files;
```

## Pipeline UI layout (hybrid model)

Three layers:
1. **Kanban buckets** — Lead, Discovery, Proposal, Won, Build, Delivery,
   Post-Sale. Each pipeline stage maps to one bucket via code-defined
   `bucketForStage()` in `src/lib/pipelineBuckets.ts`. Each (pipeline,
   bucket) pair maps to a single stage so drag-and-drop is unambiguous.
2. **Sub-status** — free-text `deals.sub_status` column. UI surfaces it
   as an inline label under the stage on each kanban card. Conditional
   dropdowns by stage will come once a sub-status registry is defined.
3. **Parallel tracks** — already shipped (PR #6). Sales / Credential /
   Build tracks on `/deals/[id]`.

### What this PR adds (PR 11)

- [x] **`/pipeline` kanban view** — 7 buckets rendered as columns,
      cards grouped by `bucketForStage(deal.stage)`. Each card shows
      customer, vehicle, pipeline label, current stage, sub-status,
      assignee, days in stage, age badge.
- [x] **Drag-and-drop with optimistic UI** — `KanbanBoard.tsx`
      (client) uses native HTML5 drag events. On drop, POSTs to
      `/api/deals/[id]/move-bucket`. Card moves locally first; if the
      server rejects (gate failure, no stage in pipeline for target
      bucket, etc.), the move is reverted and an error banner shows
      the reason.
- [x] **Card aging** — `deals.current_stage_entered_at` stamped on
      every stage change. `cardAge()` returns `fresh` / `warning` /
      `overdue` against thresholds from `pipeline_stage_sla` (per
      pipeline + stage) with fallback to `DEFAULT_BUCKET_SLA` in code.
- [x] **Admin SLA editor at `/settings/sla`** — per-pipeline table of
      stages with warning-days / overdue-days inputs; reset-to-default
      removes the DB row so the code fallback kicks in.
- [x] **Tabbed deal record page** — URL-driven `?tab=` over Details,
      Activity, Documents, Tasks, Communication. Parallel-tracks panel
      stays pinned above the tab nav. Active-task count shows as a
      badge on the Tasks tab.
- [x] **Tasks tab** — `deal_tasks` CRUD: title, description, assignee,
      department, due date. Inline complete toggle, overdue flagging,
      delete.
- [x] **Communication log tab** — `customer_messages` CRUD: channel
      (call / email / sms / in_person / meeting / other), direction
      (inbound / outbound), subject, body. Lists newest first.

### Schema additions (PR 11)

```sql
ALTER TABLE deals ADD COLUMN IF NOT EXISTS sub_status text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS current_stage_entered_at timestamp NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS pipeline_stage_sla (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_slug text NOT NULL,
  stage text NOT NULL,
  warning_days integer NOT NULL DEFAULT 3,
  overdue_days integer NOT NULL DEFAULT 7,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(pipeline_slug, stage)
);
CREATE INDEX IF NOT EXISTS pipeline_stage_sla_lookup_idx ON pipeline_stage_sla (pipeline_slug, stage);
```

### Deferred

- Conditional sub-status dropdowns (need a registry by pipeline+stage)
- Post-Sale stage on each pipeline (today no stage maps to that bucket)
- "horizontal pipeline progress bar at top of deal record" remains as
  the parallel-tracks panel from PR #6 — they serve the same purpose

### Won → Confirmed auto-trigger (PR 12, hardened in PR 13)

When a deal advances **into** the Won bucket (`po_received` or
`deposit_received` depending on pipeline), the most recent quote on
that deal is promoted from `estimate` to `workflowStage = 'confirmed'`
and — if no work order exists yet — one is created with
`status = 'confirmed'`. Implemented in `maybePromoteWonDeal()` in
`src/lib/dealTriggers.ts`, called from both `/deals` `changeStage`,
the kanban `move-bucket` API route, and the modal `stage` API route.

If `quotes.dealId` isn't yet set on any quote, the trigger falls back
to the customer's most recent non-converted quote and stamps `deal_id`
on it so subsequent triggers (and the PR-9 customer-folder auto-link)
keep working without manual relinking.

### Kanban quality-of-life (PR 13)

- **Click a card** to open a modal with deal summary (pipeline,
  stage, sub-status, days in stage, assignee, VIN, notes, latest
  activity, linked quotes) without leaving the kanban view.
- **Stage select** inside the modal — pick any valid stage for the
  pipeline. POSTs to `/api/deals/[id]/stage`, which validates with
  `canAdvanceTo` (so all gates still fire) and runs the Won
  auto-trigger.
- **"+ New deal" button** at the top right of the kanban opens a
  modal with customer / pipeline / starting-stage / vehicle / notes
  fields. POSTs to `/api/deals`.
- Quote/customer-folder shortcuts inside the modal (open quote,
  open customer folder, open full deal page).

Behaviour:
- Fires only on the forward edge (previous stage was not already in
  Won), so re-saving a Won deal doesn't loop.
- No-op if the deal has no quote yet — the deal still moves to Won.
- No-op if the quote is already past `confirmed` (in_progress, qc_check,
  etc.) — never goes backward.
- One-way: moving the deal back out of Won does NOT reverse the
  quote workflow or delete the work order.

## Communication & cross-departmental tools

The biggest pain: people not knowing what's happening on a deal. Goal is
real-time visibility across sales / shop / parts.

### What this PR adds (PR 15)

- [x] **Notifications table** — `notifications` (user_id, kind, title,
      body, link, deal_id, actor_id, read_at, created_at). Bell icon
      in the global header with unread-count badge. `/notifications`
      page lists everything, mark-as-read per row, mark-all-as-read,
      delete.
- [x] **@mention parser** — `src/lib/mentions.ts` matches `@username`
      (case-insensitive) against `users.username`, falls back to
      compact name forms (`first.last`, `firstlast`, `first`). Parsed
      mention IDs land on `deal_activity.mentions` (jsonb) and a
      `mention` notification fires for each matched user, linking to
      `/deals/[id]?tab=activity`.
- [x] **Threaded comments** — `deal_activity.parent_id` already
      existed; activity tab now groups roots vs replies, indents
      replies under their parent, and exposes a per-comment Reply
      `<details>` form that posts with the parent's `id`. Replying to
      a comment also fires a `comment_reply` notification to the
      parent's author (unless they were already in the mention list
      or they're the same person).
- [x] **Task-assignment notifications** — `createTask` now fires a
      `task_assigned` notification to the assignee.
- [x] **Doc-reminder notifications** — when PR 14's
      `maybeCreateDocReminder` drops a task, the assignee also gets a
      `doc_reminder` notification.
- [x] **"My open tasks" panel** on the home dashboard — lists every
      open `deal_tasks` row where `assigned_to = current user`, with
      customer name, vehicle, due date, overdue flagging, and a link
      back to the deal's Tasks tab.

### Schema additions (PR 15)

```sql
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
```

### Deferred (next PR)

- `notification_rules` table + admin UI to configure (from_stage,
  to_stage, customer_type, recipient_role) routing for stage changes.
- Per-stage required-field validation (422 with missing fields).
- Vercel Cron daily SLA scan + alert.
- Email delivery (Resend or similar) for in-app notifications.

## CRM ↔ Workflow synchronization

Sales and shop must work off the same record. CRM stage and Workflow
stage are two views over a single deal — when one moves the other
follows.

### Architecture (PR 16, hybrid)

The existing /workflow Kanban is keyed on `quotes.workflow_stage`,
not on deals directly. PR 16 keeps that board but makes deal stage
the authority: every deal stage change auto-creates or updates the
corresponding `work_orders` row (linked via new `work_orders.deal_id`),
and the WO status mirrors the mapped workflow stage. Sales no longer
loses visibility — the deal page surfaces a "Workflow Status" badge
that reads the live WO status; the workflow board surfaces a "CRM
Stage" badge linking back to the deal.

### Mapping (PR 16)

Stored in `stage_mapping(crm_stage, workflow_stage, sort_order)`,
editable at `/settings/stage-mapping`. Default seed:

| CRM stage                  | Workflow target   |
| -------------------------- | ----------------- |
| prospect                   | (none — pre-shop) |
| credential_verification    | (none — pre-shop) |
| quote_sent                 | estimate          |
| po_received                | confirmed         |
| deposit_received           | confirmed         |
| in_production              | in_progress       |
| delivered                  | delivered         |
| lost                       | archived          |

`workflow_stage = NULL` means the deal isn't visible on the board
yet (pre-shop). `archived` keeps the WO out of the active Kanban
but accessible for audit.

### Sync (PR 16, one-way CRM → Workflow)

`src/lib/dealTriggers.ts :: syncDealToWorkflow(dealId, newStage,
prevStage)` runs after every deal stage update:

1. Loads the mapping; if `newStage` has no workflow target, no-op.
2. If `newStage` and `prevStage` map to the same workflow stage,
   no-op.
3. Finds the WO via `work_orders.deal_id`, then via the deal's
   most recent quote. If none and the target is non-archive, a
   new WO is created (number `WO-<7-digit>`, status = target,
   `deal_id` stamped).
4. Otherwise updates `work_orders.status` to the new target.
5. Writes a `workflow_sync` row to `deal_activity` so both sides
   see the handoff in the unified feed (e.g. *"Auto-synced to
   workflow: Confirmed Builds (from CRM stage po received)."*).

Called from every deal-stage write path:
- `POST /api/deals/[id]/stage`
- `POST /api/deals/[id]/move-bucket`
- `PATCH /api/deals/[id]` (when `stage` changes)
- `/deals/[id]/edit` server action

### Schema additions (PR 16)

```sql
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
```

### PR 17 — reverse sync + guardrails + cross-module notifications

- **Workflow → CRM reverse sync** (`syncWorkflowToDeal`): when the
  shop moves a card on `/workflow`, push the corresponding CRM
  stage on the linked deal. Pipeline-aware: `confirmed` maps to
  `po_received` for government deals and `deposit_received`
  otherwise. Intermediate shop states (`awaiting_parts`,
  `next_in_line`, `qc_check`, `completed`) keep the CRM stage at
  `in_production` so we don't oscillate the sales view while the
  shop iterates internally. Stamps `work_orders.deal_id` on first
  sync if the WO was previously orphan.
- **Transition guardrails + override audit**:
  - `canAdvanceTo` now returns `{ overridable, backwards }`
    metadata on its result. Forward skips of more than one stage
    return `ok=false, overridable=true`. Credential gate is
    always strict (`overridable=false`).
  - `POST /api/deals/[id]/stage` and `POST /api/deals/[id]/move-bucket`
    accept `{ override: boolean, reason: string }`. A 400 with
    `overridable=true` tells the client to prompt for a manager
    reason and retry with `override=true`. A 200-eligible backwards
    move still requires a `reason` (400 `requiresReason=true,
    backwards=true` if missing). Every accepted override or
    backwards move logs a row to the new `stage_overrides` audit
    table AND writes a `stage_override` entry to `deal_activity`.
  - `KanbanBoard` handles both 400 shapes with a `window.prompt`
    and a single retry call. Cancel = move aborted.
- **Cross-module notifications**: both sync helpers now fire a
  `stage_change` notification.
  - CRM → Workflow: notify the WO assignee if set, else fall back
    to active users with `role IN ('manager','admin')`.
  - Workflow → CRM: notify the deal assignee if set, else fall
    back to active users with `role = 'sales'`.

### Schema additions (PR 17)

```sql
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
```

### Still deferred (post PR 17)

- **Event log table** for richer pub/sub / debugging.
- **Direct entry in Workflow** auto-creating a minimal CRM deal
  (currently /workflow still creates WOs off bare quotes; PR 17
  stamps `deal_id` if the quote already has one, but the
  no-quote-at-all path isn't covered).
- **Lifecycle stage expansion**: enum-add Spec Approval / Vehicle
  Procurement / Upfit Scheduled / Compliance / Invoiced / Paid &
  Closed; re-map. This is the next PR.
- **Customer-facing notifications** (SMS/email) triggered by
  workflow stage changes (per spec: customer-facing comms key off
  the shop, not the CRM).

## Deals (not yet built)

- [ ] Pipeline / kanban view with drag-and-drop between stages.
- [ ] Tags on each deal.
- [ ] Referral source field: options = Sames, Website, Sales person,
      manually-added name/source.
- [ ] Internal notes section.
- [ ] Quote builder lives inside the deal.
- [ ] Upfit builder lives inside the deal.

## Quotes / Estimates / Invoices

- [x] List, create draft, open editor, delete.
- [x] **Line items** with description, qty, unit price.
- [x] Per-row discount with % OR $ toggle (live recalculation).
- [x] Custom + fixed fees; both can be removed per quote.
- [x] Live totals: subtotal, discount, fees, tax, grand total.
- [x] Internal notes per quote.
- [x] Status workflow: draft → sent → approved → converted. Saving a
      quote never silently reverts the status: `saveQuote` only accepts a
      recognized status and otherwise keeps the quote's existing value
      (the old `?? "draft"` default clobbered the record back to draft
      whenever the field didn't round-trip — the "reverts to draft" bug).
- [x] **A build can't start until the quote is approved.** The workflow
      strip can move the quote up to "next in line" in any status, but
      moving it to "In Progress" (or beyond) is rejected unless the
      status is `approved` or `converted`. The strip shows the rejection
      inline instead of quietly doing nothing.
- [x] Customer dropdown.
- [x] Tax rate input per quote.
- [x] Add parts from inventory to a quote via "+ Add from inventory…"
      dropdown. Adds line with sku/name/price/partId; stock NOT deducted
      at quote time. Stock is deducted **only** when the linked work
      order crosses into "In Progress" on the workflow (gated on the
      quote being approved), and restored if the build is walked back
      before "In Progress."
- [x] Column titles on the line-items table.
- [x] Print / Save as PDF view at /quotes/[id]/print.
- [ ] Partial payment tracking, down-payment tracking.
- [ ] CAD design upload (sent during quote/closing) — uses Vercel Blob.
- [ ] Print and Send-to-customer are separate (Print done; Send pending).
- [ ] Per-customer discount calculator that pre-fills line discounts
      based on the customer's negotiated rate.

## Vehicles

- [x] **Multi-lot support**: on-site, dealership, upfitting, Sames drop-off.
      Implemented as `lotLocation` dropdown on the vehicle form.
- [x] VIN decoder via NHTSA vPIC API at `/api/vin/decode/[vin]`. Form
      auto-fills year/make/model/trim. "Save vehicle" creates the asset.
- [x] List, add, edit, delete.
- [ ] VIN history of all work completed on the vehicle (depends on
      Work Orders module).

## Inventory / Parts

- [x] List, add, edit, archive, unarchive, delete.
- [x] Pricing labels: **Internal Cost** + **Price** (single price column).
- [x] Per-part margin AND markup % live calculation in form.
- [x] Quick "set price by N% margin/markup" buttons.
- [x] Every field on the add + edit part forms carries a visible caption
      label (shared `FormField` in `@/components/FormField`), so pre-filled
      values on the edit form are self-explanatory instead of bare numbers.
- [x] Manufacturer + Supplier dropdowns sourced from Vendors.
- [x] Filters on category, vendor, archived.
- [x] **Search by SKU or part name** — `?q=` free-text box on the list
      (case-insensitive substring, `%`/`_` escaped) filtering the whole list
      server-side. Combines with the other filters/sort, resets to page 1, and
      is carried into the Print / Save-as-PDF export (shown in its filter line).
- [x] **Sortable columns** on the list — every column header (SKU, Name,
      Category, Manufacturer, Supplier, On hand, On order, Internal cost,
      Price, Margin) has up/down arrows. Sorting is server-side via
      `?sort=&dir=` (so it orders the whole filtered list, not just the
      current page), keeps filters, and resets to page 1. Vendor sorts use
      aliased joins on `vendors`; margin sorts on `(price - cost) / price`;
      NULLs always sort last. Default view is Name A→Z. Shared logic in
      `@/lib/inventorySort`; headers via `@/components/SortHeader`. The
      Print / Save-as-PDF export honors the active sort (and shows a
      "Sorted by" line), so the exported view matches the screen.
- [x] Edit pencil opens correct row (uses `/inventory/[id]/edit` pattern).
- [x] **Mass import via CSV/Excel** — `/inventory/import` UI +
      `POST /api/parts/import`. Dry-run preview → confirm; upserts by SKU
      (existing update, new create); auto-creates missing manufacturer /
      supplier vendors. This is the "load the inventory count first" step
      that Packages (below) build on top of.
  - Header matching is alias-based (`HEADER_ALIASES` in `src/lib/csv.ts`):
    the SKU column may be labeled `sku`, `manufacturer_sku` (as vendor/Whelen
    exports do), `mfg_sku`, `mfr_sku`, `part_number`, `part_no`, `partno`, or
    `item_number`; the name column may be `name`, `product_name`, `item_name`,
    or `part_name`. Unrecognized/extra columns (e.g. `Count`, `Current Count`)
    and blank headers are ignored. A missing required column returns a fatal
    error that lists which column is missing and the raw headers detected.
  - In-file **duplicate SKUs** are handled per row: the first occurrence wins
    and later rows with the same SKU are flagged (`duplicate sku in file …`)
    so they show in the dry-run preview and are skipped, rather than silently
    colliding on commit.
- [ ] Per-part PO history button — currently shown as the FIFO layers
      table on /inventory/[id]; consider a dedicated button if needed.
- [ ] Inline "Add new vendor" inside the dropdown (currently links
      out to /vendors).

## Inventory Packages / Kits (Shop Monkey "canned services")

Reusable bundles of parts + labor + fees the sales team drops onto a quote
in one click — modeled on Shop Monkey's **Canned Services** (a.k.a. canned
jobs / kits). The seamless-upload flow the user asked for is two-step and
dependency-ordered: **(1) load the inventory count** via `/inventory/import`
so every SKU exists, then **(2) load packages** whose part lines reference
those SKUs.

**Decisions (session 2026-07-02):**
- **Itemized roll-up pricing.** A package expands into individual, editable
  quote lines (each part / labor / fee shown with its own price), NOT a single
  fixed bundle price — matches the existing line-item quote model and gives
  government buyers a transparent breakdown.
- **Bundles parts + labor + fees** (full canned-service model; the quote
  editor already supports all three line kinds).
- **CSV format designed here** (no external export to match).

- [x] **`packages` table** — `name`, `category`, `description`, `components`
      (jsonb array), `tags`, `archived`. Components share the quote editor's
      line shape so expansion onto a quote is a direct map. Part components
      carry `partId` + `sku` but also snapshot `description` + `unitPrice`, so
      a package keeps working if the underlying part is later archived/renamed.
- [x] **Packages section** — `/packages` (list + create → redirect into the
      builder), `/packages/[id]/edit` (builder), JSON API
      `GET/POST /api/packages`, `GET/PATCH/DELETE /api/packages/[id]`
      (delete manager+), and `GET /api/packages/search` type-ahead (returns
      components so the quote editor expands with no second round-trip).
      Tags/archive via the shared `ListRowControls` + `/api/list-meta`
      (`packages` registered there). Nav entry under **Operations**.
- [x] **Package builder** (`PackageBuilder.tsx`) — a focused mini quote
      editor: parts via the shared `PartSearchCombobox`, labor (hours × rate),
      and fee rows, with a live undiscounted "package value" reference figure.
- [x] **Quote integration** — a "+ Add package" `PackageSearchCombobox` sits
      next to "+ Search inventory to add…" in the quote editor. Picking a
      package appends its components as editable lines (add-then-tweak, like
      Shop Monkey). Stock still deducts only when the work order hits
      "In Progress," unchanged.
- [x] **"Save as package"** button in the quote editor — turns the current
      quote's lines into a reusable package (per-line discounts dropped;
      discounting stays on the quote). POSTs to `/api/packages`.
- [x] **Package bulk upload** — `/packages/import` UI +
      `POST /api/packages/import` (dry-run preview → confirm). One row per
      component grouped by `package_name`; `part` rows resolve by SKU against
      the live catalog (unknown SKU = error, since inventory loads first).
      Upserts by name; a package with any errored row is skipped whole (no
      partial bundles). Sample template + column docs in the import UI.

### CSV columns (package import)

`package_name` (req), `component_type` (req: `part`/`labor`/`fee`),
`package_category`, `package_description`, `sku` (req for `part`), `label`
(line description; part rows default to `SKU — name`), `quantity`,
`unit_price` (blank part price defaults to the part's inventory price),
`hours`, `rate`, `amount`.

### Schema additions (Packages) — run in Neon's SQL Editor

```sql
CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived boolean NOT NULL DEFAULT false,
  tags text[],
  name text NOT NULL,
  category text,
  description text,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS packages_name_idx ON packages (name);
CREATE INDEX IF NOT EXISTS packages_tags_gin ON packages USING gin (tags);
```

### Deferred (post Packages v1)

- **Fixed-price bundle option** (single-line package price) as an alternative
  to the itemized roll-up, chosen per package.
- **Package on the PDF/print view** as a labeled group header rather than a
  flat list of lines.
- **Package profitability report** (Shop Monkey surfaces most-used / highest-
  margin canned services) once packages have quote history.
- **Reorder components** in the builder (parts/labor/fees currently append in
  add order; the quote editor's per-section drag-reorder could be reused).

## Vendors

- [x] List, add, edit, delete.
- [x] Distributor discount % field.
- [ ] Filters.
- [ ] Inline "add vendor" used by the Inventory dropdown.

## Work Orders (not yet built)

- [ ] Add parts to a work order from inventory.
- [ ] Add notes inside a work order.
- [ ] Attach quote PDFs and upfit-builder PDFs from the database.
- [ ] Tags on each work order.
- [ ] Kanban view with drag-and-drop between stages.
- [ ] QC checklist built into the workflow — must be completed to close
      a build.
- [ ] Intake checklist with photo upload + generate external PDF.

## Procurement / lead-time management (PR 19)

Procurement plans use a per-part `lead_time_days` and a per-WO target
build start date + safety buffer to compute the latest each part can
be ordered without delaying the build. Surfaces overdue and at-risk
parts across every active work order so the buyer can act before the
shop runs out of runway.

- [x] **Schema**:
  - `parts.lead_time_days int NOT NULL DEFAULT 0` (per-part quoted
    lead time).
  - `work_orders.target_build_start_date timestamp` and
    `work_orders.safety_buffer_days int NOT NULL DEFAULT 7`.
- [x] **Procurement library** (`src/lib/procurement.ts`):
  - `latestOrderDate(targetStart, leadDays, bufferDays)`.
  - `requiredPartQuantities(lineItems)` rolls up a quote's line items
    to a quantity-per-part map (free-form lines without a `partId`
    are ignored).
  - `partOrderedQuantities(openPOLines)` aggregates open PO lines so
    the same part across multiple POs is counted once.
  - `buildPartPlan` + `sortPlan` produce a status-ranked per-WO plan
    (`overdue` → `at_risk` → `comfortable` → `ordered`). At-risk
    horizon: 14 days from latest-order-by.
  - `criticalPathForPlan` returns the longest-lead part on the WO —
    the one driving the build start date.
  - `rollupVarianceByVendor` aggregates receipt-vs-quoted-lead-time
    deltas per vendor for the learning report.
- [x] **Part edit form** (`/inventory/[id]/edit`) accepts
  `leadTimeDays`.
- [x] **Work orders list** (`/work-orders`) gets two new columns:
  - **Procurement** badge group: overdue / at-risk / ordered counts
    + critical-path part inline.
  - **Target start** inline form: target build start date + safety
    buffer days, save via the `setProcurementPlan` server action.
- [x] **Parts-to-order dashboard** (`/procurement/parts-to-order`):
  one row per (WO × part) for every overdue or at-risk part across
  every active work order (statuses estimate / confirmed /
  awaiting_parts / next_in_line / in_progress / qc_check). Columns:
  status, part, vendor, qty (with already-ordered split), lead
  time, latest-order-by date, days until latest, WO, customer.
- [x] **Procurement index** (`/procurement`) cards link to
  parts-to-order, the WO procurement plan, and the variance
  report.
- [x] **Vendor lead-time variance report**
  (`/reporting/vendor-lead-times`): one sample per
  `part_receipts` row joined to its `purchase_orders.created_at`
  and `parts.lead_time_days`. Rolled up per vendor with avg
  quoted, avg actual, avg variance, worst variance. Window: 90 /
  365 / all-time.
- [x] **Reporting index** (`/reporting`) lists the variance report
  (and other reports as they land).
- [x] **Procurement** nav entry under Operations.

### Schema additions (PR 19)

```sql
ALTER TABLE parts ADD COLUMN IF NOT EXISTS lead_time_days int NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS target_build_start_date timestamp;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS safety_buffer_days int NOT NULL DEFAULT 7;
```

### Deferred (post PR 19)

- **Multi-vendor lead times per part** (`vendor_item_mapping`
  table): today `parts.vendor_id` is a single supplier and
  `parts.lead_time_days` is global. A future table keyed by
  (part_id, vendor_id) lets the buyer choose between vendors with
  different lead-time / cost trade-offs.
- **Auto-recalc on change order**: today adding a long-lead part
  mid-build surfaces in the per-WO procurement column on the next
  render. The next iteration should flag the WO and post to the
  deal activity feed ("Change order added 90d lead-time part →
  build window slips") so sales sees the impact.
- **Auto-update lead times from variance**: surface a suggested
  `lead_time_days` per part based on observed receipts (median or
  p75 of recent samples) with a one-click "apply" action.

## Purchase Orders

- [x] List + create draft + delete.
- [x] PO editor with vendor, expected date, line items (parts dropdown
      auto-fills description + cost), notes, total computed live.
- [x] **Receive shipment** flow — per-line qty entry. Each receipt:
      - Creates a `part_receipts` ledger row (qty + unit cost + date).
      - Increments `parts.quantity_on_hand`.
      - Logs `part_cost_history` entry.
      - Updates PO status to `partially_received` or `received`.
- [x] Status badges (pending/pending_review/po_received/partially_received/received).
- [ ] Filters by vendor / status / date range.

## Costing (FIFO + weighted average)

- [x] **`part_receipts` ledger table** — one row per receipt, tracks
      qty_received, qty_remaining, unit_cost, vendor, PO link.
- [x] Per-part **`/inventory/[id]` cost-history page**:
      - Weighted-average cost across remaining FIFO layers.
      - Lifetime weighted average across all receipts ever.
      - Last received cost.
      - FIFO cost preview for sample qty (1, 5, 10, 25 units).
      - Full FIFO layers table, oldest first, depleted layers dimmed.
- [x] **Consumption depletes FIFO layers** when a work order linked to
      a quote with stock parts moves to "In Progress" on the Workflow
      board — which is only allowed once the quote is approved.
      Idempotent via `work_orders.parts_consumed`.
- [ ] Restock action (manual reverse if a build is canceled).
- [ ] Optional moving-weighted-average cache on `parts` for fast lookup.

## Time Clock (not yet built)

- [ ] Clock in/out, active timers.
- [ ] **Geofencing** — only allow clock-in within a configured radius of
      the shop. Browser geolocation + radius check.
- [ ] **Build-time-per-part agent tracker**: when a part is added to a
      work order, automatically log time toward the build. (Need to
      clarify what "agent" means — likely the assigned technician.)

## Reporting / Accounting (not yet built)

- [ ] Vehicle units report grouped by customer.
- [ ] AR report: amount owed, amount paid, outstanding.
- [ ] Status report: needs pickup, in production, etc.
- [ ] **Accounting/finance agent** — automatic weekly + monthly emailed
      reports. Needs a cron + email service.
- [ ] All exports must use the branded PDF format.

## Upfit Builder

Visual spec sheet for sales: sales picks a specific vehicle template,
drops numbered pins anywhere on the multi-view blueprint image, labels
each pin (free text or part from inventory), and prints a PDF the
customer sees and the techs build to. One upfit per quote.

- [x] **Tab on `/quotes/[id]`** (`QuoteTabs`) — Quote / Upfit builder.
      Upfit page lives at `/quotes/[id]/upfit`.
- [x] **Per-vehicle templates** — each template is one composite
      blueprint image (the multi-view picture with top / front / rear /
      sides all in one). `templates.ts` maps each template slug to one
      `imageUrl` at `public/upfit-templates/<slug>.{jpg|png}`. The editor
      renders it as an `<img>`; the PDF reads the file as a Buffer and
      embeds via React-PDF `<Image>`. Pins are placed freely anywhere on
      the image and stored as fraction 0..1 of the image box, so the
      same coordinate is identical on screen and in print regardless of
      the image's aspect ratio. Templates are per-vehicle (Tahoe,
      Suburban, Blazer, Silverado, Durango, Ford PIU, F-150, F-350,
      Ford Transit Custom) rather than per body style, so the diagram
      on the spec actually matches the truck. The `upfit_configs.body_style` column name is
      preserved for backward-compat; the value now holds the per-vehicle
      slug. (The earlier five-separate-views model was dropped —
      `UpfitPin.view` is retained optional for backward-compat only.)
- [x] **Template image contract** — drop ONE JPG (or PNG) per vehicle at
      `public/upfit-templates/<slug>.jpg`. Slugs currently shipped:
      `tahoe`, `suburban`, `blazer`, `silverado`, `durango`, `piu`,
      `f150`, `f350`, `transit_custom`. Any aspect ratio works (pins track the image by
      percentage); a missing file degrades to a labeled empty box, no
      crash. No rebuild required — files are read on each render. To add
      a new vehicle: drop the JPG and append an entry to
      `VEHICLE_TEMPLATES` in `src/lib/upfit/templates.ts`.
- [x] **Per-diagram vehicle label** — every diagram view (editor +
      PDF) is headed with the specific make/model, e.g. "2024
      Chevrolet Tahoe". `upfit_configs.vehicle_label` stores it;
      defaults from the linked deal's vehicle fields (or the deal's
      `vehicleId` → `vehicles` row) via `resolveVehicleLabel()` in
      `src/lib/upfit/vehicleLabel.ts`, and is editable in the builder
      so a spec can target a different unit than the deal record.
- [x] **Builder UI** (`src/components/UpfitBuilder.tsx`, client) —
      body-style dropdown, part-from-inventory picker OR free-text
      label, click-to-place pins on the single blueprint image,
      **pointer-drag to reposition placed pins** (1%-of-box threshold
      separates click-to-select from drag-to-move), per-pin placement
      note, build notes textarea. Pins are HTML overlays positioned by
      percentage over the `<img>`. "Save upfit" persists via a server
      action on the page.
- [x] **Equipment-styled pins** — pins are drawn as colored rectangles
      (not circles), matching how real lights look on a build sheet.
      Each pin has:
      - **Size**: `small` / `medium` / `large` / `strip` (for
        lightbars and tracer arrays). Dimensions defined as fractions
        of the diagram so they scale consistently between editor and
        PDF.
      - **Color scheme**: solids (red, white, blue, amber, green),
        50/50 splits (red/white, blue/white, amber/white, red/blue,
        green/white), and multi-segment tracer patterns (R/W ×4, R/W
        ×6, B/W ×4, R/B ×4). Stored as a slug; segments rendered
        side-by-side in the rectangle.
      - **Orientation**: `horizontal` (default) or `vertical` for
        pillar / quarter-window lights.
      - **Caption**: short label drawn on the diagram below the
        rectangle (e.g. "VXE SMOKED LENS R/W"). Distinct from `notes`,
        which is internal and only prints in the equipment table.
      Catalogs live in `src/lib/upfit/templates.ts` (`PIN_SIZES`,
      `COLOR_SCHEMES`). All visual fields are optional on the pin
      record so older saved pins keep rendering (defaults: medium /
      red_white / horizontal). The PDF mirrors the same rendering for
      a byte-for-byte match between editor and print.
- [x] **Place same part multiple times** — picking a part (or typing a
      label) enters "placement mode" and stays in it across clicks, so
      the same SKU can be placed on every corner/pillar of the vehicle
      without re-selecting. Explicit "Stop placing" button on the hint
      banner clears the selection when done.
- [x] **Persistence** — `upfit_configs(quoteId UNIQUE, body_style,
      pins jsonb, notes)`. One row per quote, upserted on save. Cascade
      deletes when the quote is deleted.
- [x] **PDF spec sheet** — `src/lib/pdf/templates/upfit.tsx` renders
      branded header + customer/vehicle block + the full-width
      blueprint image with rectangle pins (matching the editor's size,
      color scheme, orientation, and on-diagram caption) overlaid by
      percentage + equipment table (# · label · SKU · caption ·
      placement note) + build notes.
      Streamed from `GET /api/pdf/upfit/[quoteId]` (audit-logged with
      `record_type = upfit`). Download button on the upfit tab.
- [x] **Customer-folder auto-link** — `upsertUpfitLink(quoteId)` in
      `src/lib/customerDocLinks.ts` writes one stable
      `customer_documents` row keyed by `kind = auto_link:upfit:<quoteId>`
      into the customer folder under the **Photos / Build Documentation**
      category. The row's `blob_url` points at `/api/pdf/upfit/<quoteId>`
      and its `mime_type` is `application/pdf`, so the customer-folder
      list link streams the live spec PDF rather than a stale snapshot.
      Called on every save; purged when the quote has no customer.
- [ ] **Standalone tool** outside the quote context (deferred).
- [ ] **CAD upload** attachable to the upfit config (deferred).
- [x] **Build packages** — shipped as the Inventory Packages / Kits module
      (see that section). Reusable part+labor+fee bundles, buildable in the
      UI or bulk-uploaded by CSV, added to a quote in one click.
- [ ] **Per-vehicle photos** as an alternative to the templates
      (deferred — pin coords are template-relative today).

### Schema additions (Upfit Builder)

Run in Neon's SQL Editor before deploying:

```sql
CREATE TABLE IF NOT EXISTS upfit_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE UNIQUE,
  body_style text NOT NULL DEFAULT 'suv',
  vehicle_label text,
  pins jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS upfit_configs_quote_idx ON upfit_configs (quote_id);
```

If the table already exists from an earlier deploy, add the column:

```sql
ALTER TABLE upfit_configs ADD COLUMN IF NOT EXISTS vehicle_label text;
```

## Users (not yet built)

- [ ] Admin-only management.
- [ ] User selectable as "assigned sales associate" in CRM dropdown.

## Open questions for the user

1. **"Agent tracker for build time per part"** — does "agent" mean the
   assigned technician (employee), or an AI agent?
2. **Logo file** for branded PDFs — needs to be uploaded to `public/`.
3. **Email sending** — which provider? Resend / SendGrid / M365 SMTP?
4. **Time-clock geofence** — shop address (lat/lng) and radius (meters)?
5. **Accounting reports** — who receives, what's in them?
6. **Workflow page**: ✅ confirmed. Top-level `/workflow` 8 columns
   (Estimates → Delivered). Phase 2: drag-and-drop, search/filter,
   tags on cards, photo thumbnails, bulk actions.

## VIN → Shopify car listings (`vinToShopify/`)

Standalone, dependency-free Node.js ES-module (lives at the repo root,
also imported by the Next.js app) that creates Shopify car listings
from a VIN.

- `createCarListing(input)` pipeline:
  validate VIN → decode via NHTSA vPIC → build product → create in Shopify.
- Input: `vin`, `price`, optional `condition`, `mileage`, `photoUrls`,
  `notes`, `productType` (default "Used Vehicle"), `status` (default "draft").
- VIN validation: 17 chars, no I/O/Q. NHTSA `ErrorCode` must be "0"/"0,…".
- Shopify Admin REST `2024-10`. Auth uses the Dev Dashboard OAuth
  `client_credentials` flow (short-lived ~24h access token, cached in
  memory). Credentials read from `SHOPIFY_STORE_DOMAIN`,
  `SHOPIFY_CLIENT_ID`, and `SHOPIFY_CLIENT_SECRET` env vars (never
  hardcoded). The installed Dev Dashboard app must have the
  `write_products` scope.
- Variant: SKU = VIN, inventory_management "shopify", quantity 1,
  requires_shipping true, weight 0.
- Returns `{ status, productId, adminUrl, storefrontUrl, title, decoded }`
  or `{ status: "error", stage, error }`.
- TypeScript types for the module live in `vinToShopify/index.d.ts`
  (the JS files themselves stay plain ES modules so the CLI keeps
  working with `node --env-file=vinToShopify/.env vinToShopify/example.js`).
- Deferred (noted in module README): update-by-SKU, local photo uploads,
  explicit InventoryLevels per location, `orders/create` sold-car webhook,
  GraphQL Admin API migration.

### Publish from Vehicles (`/vehicles`)

Vehicles is the single source of truth for what we own. To publish a
car to Shopify, the car must exist in `/vehicles` first — no
duplicate-entry standalone form. Each row on `/vehicles` has a
"Publish" inline action.

**Schema additions on `vehicles`** (live in Neon; same migration that
ships this feature):

- `condition text` — "Used - Excellent" / "Used - Good" / "Used - Fair"
  / "New".
- `description text` — public-facing Shopify product description. The
  publish action prefers this over the internal `notes` field when
  sending to Shopify; `notes` stays internal-only.
- `shopify_product_id text unique` — set after a successful publish.
  Null means the vehicle has never been published. Acts as the
  duplicate-prevention guard.
- `shopify_status text` — "draft" or "active", mirroring what we sent
  to Shopify at publish time.
- `shopify_published_at timestamptz` — when we hit Shopify
  successfully. Useful for audit.

(`list_price`, `purchase_price`, and `photos jsonb` already existed on
the table and are now exposed in the add/edit forms.)

**Photo uploads**: handled via Vercel Blob with client-side direct
upload, so we bypass the 4.5 MB serverless body limit and don't proxy
files through our function. Wired in:

- `src/components/VehiclePhotos.tsx` — client component on the edit
  page. Renders thumbnail grid + "Add photos" file picker (multi-file,
  jpeg/png/webp/heic up to 15 MB each). Photos are persisted by
  appending to `vehicles.photos` (jsonb string[]).
- `src/app/api/blob/upload/route.ts` — token-issuing endpoint using
  `handleUpload` from `@vercel/blob/client`. Auth-gated to any signed-in
  user.
- `src/lib/vehiclePhotoActions.ts` — server actions
  `addVehiclePhoto(vehicleId, url)` / `removeVehiclePhoto(vehicleId,
  url)` / `reorderVehiclePhotos(vehicleId, newOrder)`. Remove also
  best-effort-deletes the blob via `del()`. Reorder validates that
  the new list is a permutation of what's stored, then writes the
  ordered array back. The first entry in the array is the cover
  photo on Shopify.
- Drag-and-drop reordering uses native HTML5 drag events (no extra
  dependency) — the user drags a tile onto another tile and the
  client optimistically swaps order, then persists; on failure the
  optimistic state is rolled back.

**Publish action** (`publishVehicleAction` in `src/lib/publishVehicle.ts`):

- Role gate: admin or manager only.
- Pre-flight: requires `vin`, `list_price`, and at least one photo.
  The row UI hides the publish button and shows the reason inline if
  any of those are missing.
- Body: calls `createCarListing` with the vehicle's stored fields
  (vin, list_price → price, condition, mileage, photos → photoUrls
  in their ordered DB position, `description ?? notes` → notes)
  plus the form's chosen status (draft default / active).
- Callable from both `/vehicles` (list-row inline publish) and
  `/vehicles/[id]/edit` (panel at the bottom). The form posts a
  `returnTo` hidden field so the result banner appears on whichever
  page launched it.
- On success: stores `shopify_product_id`, `shopify_status`,
  `shopify_published_at` on the row and redirects with
  `?published=1&publishId=<id>`, rendering a green banner with a link
  to the Shopify admin product URL.
- On failure: redirects with `?publishError=<message>&publishId=<id>`,
  rendering a red banner. The vehicle row is unchanged so the user
  can fix and retry.
- `vehicles_shopify_product_id_unique` constraint prevents accidental
  republish via DB-level guarantee; the action also short-circuits
  with a friendly error.

**Shopify column** on the `/vehicles` table shows current state:

- Published: badge with `shopify_status` and a "View →" link to the
  Shopify admin URL (constructed at render time from
  `process.env.SHOPIFY_STORE_DOMAIN`).
- Ready to publish: inline `Draft|Active` select + "Publish" button
  (admin/manager only).
- Missing data: short inline hint ("Add a VIN to publish.", etc.)
  with no button.

**Env vars required**: `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`,
`SHOPIFY_CLIENT_SECRET` (already documented above) **plus**
`BLOB_READ_WRITE_TOKEN`, which Vercel auto-injects after creating a
Blob store under Project → Storage → Create → Blob. No manual
copy-paste needed.

**Deferred**: update/re-publish to Shopify when vehicle data changes
(currently one-shot create), unpublish/archive on Shopify when a
vehicle is sold, reordering photos, designating a "cover" photo,
image compression / thumbnail variants.

## Hardening roadmap (replacing a packaged ERP — NetSuite-grade reliability)

We are NOT migrating to NetSuite; we are building this app into the
production ERP that makes buying one unnecessary. That raises the bar:
ledgers must never lie, roles must be enforced server-side, and core
operational modules must actually exist. A four-track QA dissection
produced the backlog below. Tracks are tackled in dependency order.

- **Phase 1 — Data integrity** (this PR). ✅ see below.
- **Phase 2 — Security / RBAC.** Central role-enforcement helper on every
  mutating route + the document-upload path; timing-safe webhook secret
  comparison; input/enum validation (reject unknown enum values and
  coerce-to-`[object Object]` numerics).
- **Phase 3 — Operational modules.** Work Orders (create/edit/detail UI,
  parts, notes, tags), QC checklists wired to build-close, Time Clock
  (geo-tagged clock-in + per-work-order technician tracker for labor
  $/hours per build — needs shop lat/lng + radius from the user).
- **Phase 4 — CRM cross-cutting.** Filter-by-column + tags + archive on
  every list; remove the dead `/timeclock` nav 404; drop dead tables
  (`deal_comms`, and the others once their modules land or are cut).
- **Phase 5 — Performance.** Indexes on hot filter columns
  (`quotes(deal_id,customer_id,status)`, `work_orders(status,...)`,
  `purchase_orders(status)`, `leads(status)`, `deal_tasks(assigned_to)`),
  pagination on every unbounded list, SQL aggregates in dashboard
  metrics, dashboard KPI caching.

Email/outbound notifications are deferred: build a provider adapter
interface, keep notifications in-app only until a provider is chosen.

### Phase 1 — Data integrity (shipped)

Every stock- and ledger-moving operation is now transactional and
idempotent. The two duplicated, non-transactional FIFO loops were
replaced by one module; deal-stage transitions were unified behind one
guarded function.

- [x] **`src/lib/inventory.ts`** — the single home for stock movement.
  - `consumeWorkOrderParts(woId)` — transactional FIFO consumption.
    Locks the `work_orders` row `FOR UPDATE`; the `parts_consumed`
    latch makes it idempotent (a second call, or a concurrent
    deal-driven + workflow-board move, is a no-op). On-hand is floored
    at zero (`GREATEST(0, …)`) so inventory can never go negative;
    layer shortfalls are returned as `shortages` instead of corrupting
    stock.
  - `restoreWorkOrderParts(woId)` — reverses a consumption (build
    walked back before `in_progress`, or cancelled). Refills the oldest
    layers first, capped at each layer's original received quantity.
  - `receivePurchaseOrder(poId, receiveByIndex)` — transactional PO
    receive. Locks + re-reads the PO row inside the txn, so two
    simultaneous receives serialize instead of double-incrementing
    stock. Receipt layer + on-hand bump + cost-history row are all-or-
    nothing.
- [x] **FIFO consumption keyed to stage, both directions.** Advancing a
  quote/WO to or past `in_progress` consumes once; moving it back before
  `in_progress` restores. Both quote-side stage moves now flow through
  the **single** `POST /api/quotes/[id]/workflow-stage` endpoint: the
  `/workflow` Kanban (`WorkflowBoard`) and the `/quotes/[id]` workflow
  strip (`QuoteWorkflowStrip`) both call it. The old `/quotes/[id]`
  `moveStage` server action was removed — it duplicated the logic, ran
  no CRM sync, and failed silently (which read to users as the move
  "reverting"). The endpoint returns typed 400s the UI surfaces.
- [x] **Approval gate before a build can start.** The
  `POST /api/quotes/[id]/workflow-stage` endpoint rejects any move to
  `in_progress` (or a later stage) unless `quotes.status` is `approved`
  or `converted`, returning `400 { needsApproval: true }`. This is the
  single gate that also protects inventory — because deduction is keyed
  to the same `in_progress` crossing, stock can never leave the system
  for an unapproved quote. Both the workflow strip and the Kanban board
  show the rejection message.
- [ ] **CRM-side entry into `in_progress` (deferred).** `syncDealToWorkflow`
  can set a work order's status to `in_progress` when a deal's CRM stage
  moves to `in_production`. That path updates the WO status but does not
  run `consumeWorkOrderParts` and does not apply the approval gate, so
  the "deduct at in_progress / only when approved" guarantee holds only
  for the quote/workflow-board paths today. Consolidating all three
  entry points behind one guarded "advance work order" helper (calling
  the idempotent `consumeWorkOrderParts`) is the clean follow-up.
- [x] **`src/lib/dealStage.ts :: applyDealStageChange`** — the single
  guarded deal-stage transition. Runs `canAdvanceTo` (credential hard
  gate included), captures override/backwards reasons into
  `stage_overrides`, then fires the Won promotion, doc reminder, and
  CRM→Workflow sync. Now used by `POST /api/deals/[id]/stage`,
  `POST /api/deals/[id]/move-bucket`, AND `PATCH /api/deals/[id]`. The
  generic PATCH previously wrote `stage` directly and bypassed every
  gate — that hole is closed (stage changes through PATCH now return the
  same 400s as the dedicated endpoint).
- [x] **Won auto-promotion hardened.** `maybePromoteWonDeal` runs in a
  transaction with the quote row locked, re-checks `workflow_stage`
  inside the lock (prevents the double-WO race), and stamps `deal_id` on
  the created work order so the follow-on sync finds it instead of
  creating a duplicate.
- [x] **FK constraints declared** in `src/db/schema.ts` for the columns
  that were bare UUIDs (`leads.partner_id/partner_contact_id/
  converted_deal_id`, `deals.partner_id/partner_contact_id`,
  `customer_documents.parent_document_id`, `deal_activity.parent_id`,
  `lookups.parent_id`).

#### Schema additions (Phase 1) — run in Neon's SQL Editor

The Drizzle schema declares these, but the live DB only enforces them
after you run the SQL. Add the work-order uniqueness guard and the
missing foreign keys. The FKs use `NOT VALID` so they don't fail on a
busy table; validate after confirming there are no orphan rows.

```sql
-- One work order per quote (defense-in-depth against the duplicate-WO
-- race). If this errors, you already have dupes — see the detection
-- query below and merge/delete them first.
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_quote_unique
  ON work_orders (quote_id) WHERE quote_id IS NOT NULL;

-- Detect existing duplicate work orders per quote (run if the index fails):
--   SELECT quote_id, count(*) FROM work_orders
--   WHERE quote_id IS NOT NULL GROUP BY quote_id HAVING count(*) > 1;

-- Foreign keys (ON DELETE SET NULL so deleting a parent nulls the ref
-- rather than orphaning it). NOT VALID skips the initial full-table check.
ALTER TABLE leads  ADD CONSTRAINT leads_partner_id_fk
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE leads  ADD CONSTRAINT leads_partner_contact_id_fk
  FOREIGN KEY (partner_contact_id) REFERENCES partner_contacts(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE leads  ADD CONSTRAINT leads_converted_deal_id_fk
  FOREIGN KEY (converted_deal_id) REFERENCES deals(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE deals  ADD CONSTRAINT deals_partner_id_fk
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE deals  ADD CONSTRAINT deals_partner_contact_id_fk
  FOREIGN KEY (partner_contact_id) REFERENCES partner_contacts(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE customer_documents ADD CONSTRAINT customer_documents_parent_fk
  FOREIGN KEY (parent_document_id) REFERENCES customer_documents(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE deal_activity ADD CONSTRAINT deal_activity_parent_fk
  FOREIGN KEY (parent_id) REFERENCES deal_activity(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE lookups ADD CONSTRAINT lookups_parent_fk
  FOREIGN KEY (parent_id) REFERENCES lookups(id) ON DELETE SET NULL NOT VALID;

-- After confirming no orphans, promote each to fully validated, e.g.:
--   ALTER TABLE leads VALIDATE CONSTRAINT leads_partner_id_fk;
--   (repeat per constraint above)
```

A one-time reconciliation to catch any drift the old non-transactional
code already introduced (on-hand should equal the sum of remaining FIFO
layers for parts that are receipt-tracked):

```sql
SELECT p.id, p.sku, p.quantity_on_hand,
       COALESCE(SUM(r.quantity_remaining), 0) AS fifo_remaining
FROM parts p
LEFT JOIN part_receipts r ON r.part_id = p.id
GROUP BY p.id, p.sku, p.quantity_on_hand
HAVING p.quantity_on_hand <> COALESCE(SUM(r.quantity_remaining), 0);
```

### Phase 2 — Security / RBAC (shipped)

Authentication was already enforced everywhere; this phase adds
authorization. Policy lives in one place: `src/lib/rbac.ts`.

- [x] **`src/lib/rbac.ts`** — `roleOf`, `hasRole`, `requireRole` (route
  guard returning 401/403), capability shortcuts (`canDelete`,
  `canManageUsers`, `canOverrideStageGate`), and `secretEquals`
  (constant-time shared-secret compare).
- [x] **Delete is manager+** on every entity route: customers, deals,
  quotes, purchase-orders, parts, vendors, vehicles, leads. A
  warehouse/tech/sales account now gets 403 on DELETE instead of
  wiping records.
- [x] **Stage-gate override is manager+.** `POST /api/deals/[id]/stage`,
  `/move-bucket`, and `PATCH /api/deals/[id]` reject `override: true`
  from non-managers (403). Combined with Phase 1's `applyDealStageChange`
  chokepoint, a rep can no longer self-authorize skipping the credential
  gate.
- [x] **Document-upload RBAC.** `POST /api/deals/[id]/documents` now
  checks `categoryVisibleTo(category, role)` before writing — the same
  gate that protected downloads. A non-manager can no longer drop files
  into contracts/credentials/invoices/compliance folders. Also caps
  uploads at 25 MB.
- [x] **Timing-safe webhook secrets.** `/api/leads/capture` and
  `/api/cron/expiring-credentials` compare their shared secret with
  `crypto.timingSafeEqual` (via `secretEquals`) instead of `===`. Both
  still fail closed when the env var is unset.
- [x] **Input / enum validation.** `PATCH /api/quotes/[id]` rejects
  invalid `status` enum values and non-finite/negative money fields
  (no more `String({})` → `"[object Object]"` landing in numeric
  columns). `POST`/`PATCH /api/customers[/id]` validate the
  `customer_type` enum.

Remaining (lower-severity, follow-up): per-rep ownership scoping (IDOR)
on `sales`-role reads; narrowing `/api/users` exposure; extending the
enum/numeric validation pattern to vendors/vehicles/parts writes.

### Phase 3a — De-priced work-order build sheet (shipped)

Requirement (from the user, with example PDFs): a work order must match
the estimate/invoice exactly, but when an estimate converts it becomes a
work-order PDF with **all pricing removed** — only **part name, brand,
manufacturer part number, and quantity** per line.

- [x] **`src/lib/pdf/templates/workOrder.tsx`** — `WorkOrderDocument`,
  the de-priced build sheet. Same header/branding as the estimate;
  columns are Part · Brand · Part # · Qty. No unit price, discount, fee,
  tax, or total appears anywhere. Fee lines are dropped entirely.
- [x] **Registry + endpoint.** `work_order` record type added to
  `src/lib/pdf/registry.tsx` (resolver sources line items from the
  linked estimate so it always matches, resolves brand from the part's
  manufacturer and part # from the new mfg field). Download/inline at
  `GET /api/pdf/work-orders/[id]`.
- [x] **Auto-generate on conversion.** When a deal converts into Won and
  the estimate is promoted to a work order, `applyDealStageChange` calls
  `upsertWorkOrderLink`, which drops a live-PDF link into the customer
  folder under Spec / Build Approvals. The link renders the current
  de-priced PDF on every click (no stale blobs).
- [x] **`parts.mfg_part_number`** column added (the manufacturer/brand
  part number, distinct from the internal SKU). Surfaced on the part
  add + edit forms. The work-order PDF prints `mfg_part_number` and
  falls back to `sku` when it's blank. "Brand" = the part's manufacturer
  vendor name (`parts.manufacturer_id`).

#### Schema addition (Phase 3a) — run in Neon's SQL Editor

```sql
ALTER TABLE parts ADD COLUMN IF NOT EXISTS mfg_part_number text;
```

Backfill is optional — until set, the work-order sheet shows the
internal SKU as the part number.

### Phase 3b — Time Clock (shipped)

Geo-verified clock-in plus per-build labor tracking. Also fixes the dead
`/timeclock` nav link (it 404'd — the route now exists).

- [x] **Reused the existing `time_entries` table** (it was scaffolded but
  unused — `workOrders` already had a relation to it) instead of adding a
  parallel one. Extended it with geofence telemetry: lat/lng at both
  punches, clock-in distance from the shop, and whether it passed the
  geofence. `work_order_id` ties labor to a build.
- [x] **Hardcoded geofence** in `src/config/shopLocation.ts` — shop at
  `30.12285632819516, -96.10635062783578`, radius **150 m**, enforcement
  ON. Haversine distance check. Edit + redeploy to move/resize/disable.
- [x] **`src/lib/timeclock.ts`** — transactional `clockIn` / `clockOut`
  (one open shift per user, enforced by a `FOR UPDATE` lock on the open
  row), `getOpenEntry`, and `laborByWorkOrder` (SQL roll-up of hours +
  labor $ per work order). Labor rate: `src/config/labor.ts`
  (`DEFAULT_LABOR_RATE_USD_PER_HOUR = 95`).
- [x] **API**: `POST /api/timeclock/clock-in` (validates geofence; 403
  when off-site, 409 when already clocked in) and
  `POST /api/timeclock/clock-out`.
- [x] **`/timeclock` page** — clock in/out panel (browser geolocation),
  build picker, the user's recent punches (off-site punches flagged),
  and a "Labor per build" table (hours + labor $).
- [x] **WO PDF link** surfaced on the `/work-orders` list, and the
  `deleteWO` server action now requires manager+ (server-action delete
  was outside the Phase 2 API-route sweep).

#### Schema addition (Phase 3b) — run in Neon's SQL Editor

```sql
-- Extend the existing (unused) time_entries table with geofence telemetry.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_lat numeric(10,6);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_lng numeric(10,6);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_distance_meters numeric(10,1);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_within_geofence boolean;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_lat numeric(10,6);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_lng numeric(10,6);
CREATE INDEX IF NOT EXISTS time_entries_work_order_idx ON time_entries (work_order_id);
CREATE INDEX IF NOT EXISTS time_entries_open_idx ON time_entries (clocked_out_at);
```

Still queued in Phase 3: Work Orders create/edit/detail UI (currently
list-only) and QC checklists wired to build-close.

### Phase 3c — Work Orders detail/edit + QC checklists (shipped)

Work orders were list-only and QC didn't exist as a feature (the
`qc_checklists` table was scaffolded but unused). Both are now wired up.

- [x] **Work order detail page** `/work-orders/[id]` — header/status,
  customer + vehicle + linked estimate, the de-priced parts list, an
  editable block (assignee, priority, target build start, safety buffer,
  notes), the per-build labor roll-up (hours + $), the WO PDF link, and
  the QC checklist. WO numbers on `/work-orders` link here.
- [x] **`src/lib/workOrderParts.ts`** — one resolver for a work order's
  de-priced parts (name/brand/part #/qty), now used by BOTH the PDF
  registry and the detail page so they can't drift (same de-dup
  discipline as Phase 1's inventory module).
- [x] **QC checklists** (`src/lib/qc.ts`) — one checklist per work order,
  seeded from a standard upfit template on first open; per-item
  pass/fail + notes saved from the detail page; `completed_at` /
  `completed_by` stamped when the whole list passes.
- [x] **Build-close gate.** A build cannot move into `completed` or
  `delivered` until `qcComplete` is true — enforced in BOTH stage paths
  (`POST /api/quotes/[id]/workflow-stage` returns 400 `qcIncomplete`;
  the `/quotes/[id]` `moveStage` server action refuses to advance).
- [x] **Work order JSON API** — `GET/POST /api/work-orders`,
  `GET/PATCH/DELETE /api/work-orders/[id]` (delete manager-only; `status`
  intentionally not writable here so closes go through the workflow path
  and hit the QC gate).

Deferred (minor): work-order tags (needs a column) and a dedicated
manual-create UI form (work orders are auto-created from quotes; the
JSON POST exists for now). No schema changes in 3c — `qc_checklists`
already exists in the live DB.

### Phase 5 — Performance (partial — indexes + dashboard aggregates)

- [x] **Dashboard count aggregates.** `operationsKpis` no longer selects
  every matching work-order row to `.length` it — the active /
  scheduled-this-week / ready / past-due KPIs now run as SQL `count()`.
  (The sales/admin value KPIs reuse their rows for grand-total sums, so
  they stay row selects.)
- [x] **Pagination** on every list page (done in Phase 4).
- [x] **Dashboard KPI caching** — `salesKpis` / `operationsKpis` /
  `adminKpis` wrapped in `unstable_cache` (60s revalidate). Action-item
  lists stay uncached (must be live).

#### Hot-path indexes (Phase 5) — run in Neon's SQL Editor

These back the most common filters/joins. Plain `CREATE INDEX IF NOT
EXISTS` (run individually; swap to `CONCURRENTLY` if any table is large
and you can't take a brief lock). They are intentionally NOT declared in
`schema.ts` — we never run drizzle-kit (CLAUDE.md), so the live indexes
won't be dropped, and keeping perf indexes out of the schema avoids
implying a migration path that doesn't exist.

```sql
CREATE INDEX IF NOT EXISTS quotes_deal_idx        ON quotes (deal_id);
CREATE INDEX IF NOT EXISTS quotes_customer_idx    ON quotes (customer_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx      ON quotes (status);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders (status);
CREATE INDEX IF NOT EXISTS work_orders_target_idx ON work_orders (target_build_start_date);
CREATE INDEX IF NOT EXISTS work_orders_quote_idx  ON work_orders (quote_id);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders (status);
CREATE INDEX IF NOT EXISTS deals_stage_idx        ON deals (stage);
CREATE INDEX IF NOT EXISTS deals_customer_idx     ON deals (customer_id);
CREATE INDEX IF NOT EXISTS deals_assigned_idx     ON deals (assigned_to);
CREATE INDEX IF NOT EXISTS leads_status_idx       ON leads (status);
CREATE INDEX IF NOT EXISTS deal_tasks_assigned_idx ON deal_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS deal_credentials_expires_idx ON deal_credentials (expires_at);
```

### Phase 4 — CRM cross-cutting (in progress)

- [x] **Dead `/timeclock` nav link fixed** — the route now exists (Phase 3b).
- [x] **Reusable list search + pagination** — `src/lib/pagination.ts`
  (`parsePagination`, `pageCount`) + `src/components/Pagination.tsx`.
- [x] **Search + pagination applied to:** deals (customer/VIN/make/model/
  rep + stage), leads (name/email/phone + status), quotes (quote #/
  customer + status). 50/page, SQL `count()` + limit/offset, filters
  preserved across pages.
- [x] **Manager-only delete** extended to the deals, quotes, and leads
  delete server actions (server-action deletes were outside the Phase 2
  API sweep).
- [x] **All core lists now paginated + filterable:** deals, leads,
  quotes, customers/CRM (search), work orders (WO#/status), purchase
  orders (status), inventory (existing filters + pagination). Every list
  query is now `count()` + `limit/offset` instead of full-table loads.
- [x] **Manager-only delete** on the customers and purchase-order delete
  server actions too (full server-action parity with the API routes).
- [x] **Tags + archive on every list.** Added `tags text[]` to deals,
  customers, leads, quotes, work_orders, purchase_orders, parts, and
  `archived` to all of those that lacked it. Each list now has an
  Active/Archived toggle, tag-chip filtering (click a tag to filter;
  chip in the bar to clear), inline tag editing, and an Archive/Unarchive
  action — all via the shared `ListRowControls` (client) + `ListFilters`
  (server) components and a generic `PATCH /api/list-meta` endpoint
  (entity + id → tags/archived; any authenticated user, since it's
  non-destructive). Inventory keeps its existing archive control and
  gains tags.

#### Schema additions (tags + archive) — run in Neon's SQL Editor

```sql
ALTER TABLE deals           ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE customers       ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE leads           ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE quotes          ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE work_orders     ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

ALTER TABLE deals           ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE customers       ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE leads           ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE quotes          ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE work_orders     ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE parts           ADD COLUMN IF NOT EXISTS tags text[];

-- GIN indexes so tag-contains (@>) filtering stays fast.
CREATE INDEX IF NOT EXISTS deals_tags_gin           ON deals USING gin (tags);
CREATE INDEX IF NOT EXISTS customers_tags_gin       ON customers USING gin (tags);
CREATE INDEX IF NOT EXISTS leads_tags_gin           ON leads USING gin (tags);
CREATE INDEX IF NOT EXISTS quotes_tags_gin          ON quotes USING gin (tags);
CREATE INDEX IF NOT EXISTS work_orders_tags_gin     ON work_orders USING gin (tags);
CREATE INDEX IF NOT EXISTS purchase_orders_tags_gin ON purchase_orders USING gin (tags);
CREATE INDEX IF NOT EXISTS parts_tags_gin           ON parts USING gin (tags);
```
- [x] `deal_comms` removed from the schema (was dead — no code refs).
  Drop the live table when ready: `DROP TABLE IF EXISTS deal_comms;`

## Accounting module (phased — from the Accounting Build Brief)

A double-entry accounting module that runs **alongside QuickBooks Online**
(not a replacement). Manages day-to-day finances, AR, AP, aging for both,
inventory with cost accounting, job costing by work order, and prepares
figures for tax filings. Two AI agents (AR + AP) assist in Phase 7.

**Stack decision (session 2026-06-23):** the brief was written for a fresh
Supabase app, but this project already runs on **Neon + Drizzle + NextAuth**
and is deployed. Per the user, we **adapt the brief's accounting substance to
the existing stack** rather than migrate to Supabase. Concretely:
- Database stays Neon; schema changes are applied by hand via SQL in
  `docs/sql/` (the brief's "checked-in migration files" maps to these), not
  drizzle-kit migrate/push — same as every prior PR here.
- Auth stays NextAuth + middleware + role checks; the brief's "Row Level
  Security" maps to that app-level enforcement, not Postgres RLS.
- AR reuses the existing `quotes`/`deals` (converted quotes already act as
  invoices) rather than building a parallel `invoices` table; a
  receipts/payments table is added when Phase 2 lands.

**Non-negotiable engineering rules (apply to every accounting phase):**
1. Money stored as integer **cents** (`bigint`), never floating point.
2. **Double-entry integrity** enforced by a DB trigger (debits = credits),
   not just app code.
3. **Posted entries are immutable** — fix mistakes with a reversing entry,
   never edit/delete history.
4. Audit trail: `created_at`, `updated_at`, and `created_by` where relevant.
5. Costing method is per item, `average` is the default (Phase 4).
6. Inventory subledger must always reconcile to the Inventory ledger account
   (Phase 4).
7. Agents may only DRAFT/RECOMMEND; explicit human approval before any
   external action (Phase 7).
8. Every cost carries its dimensions — `department_id` (+ `work_order_id`
   for jobs); job costs come from real labor/material transactions only.

### Phase 1 — Core ledger ✅ (PR: accounting-phase-1)

Schema in `src/db/schema.ts`; SQL to run in Neon at
`docs/sql/accounting_phase1.sql` (idempotent; creates enums, tables,
triggers, and seeds).

- [x] **`departments`** (`code`, `name`, `is_active`) — seeded with exactly
      five: Admin, Upfitting, Mechanics, Body Shop, General.
- [x] **`gl_accounts`** (chart of accounts) — `code`, `name`, `type`
      (asset/liability/equity/revenue/expense), `report_group`
      (revenue/labor/other_expense/none — drives the Phase 6 P&L grouping),
      `normal_balance` (debit/credit), `is_active`. Named `gl_accounts`
      because `accounts` is already the NextAuth OAuth-link table.
- [x] **`journal_entries`** — `entry_date`, `memo`, `source`
      (manual/ar/ap/system), `status` (draft/posted/void),
      `reverses_entry_id`, `created_by`, `posted_at`.
- [x] **`journal_lines`** — `journal_entry_id`, `account_id`, `debit_cents`,
      `credit_cents` (bigint), optional `department_id` + `work_order_id`
      cost-dimension tags, `memo`. CHECK constraint: a line is either a debit
      or a credit, never both, never negative.
- [x] **DB triggers** (`docs/sql/accounting_phase1.sql`):
      - balance guard — posting (status → posted) requires non-empty lines
        with `sum(debit_cents) = sum(credit_cents)`; stamps `posted_at`.
      - immutability — posted entries can't be updated or deleted; lines of a
        posted entry can't be inserted/updated/deleted. Reverse instead.
- [x] **Seed chart of accounts** tagged with `report_group` (Cash, AR,
      Inventory, WIP, AP, Sales Tax Payable, Owner's Equity, Retained
      Earnings, Sales Revenue, Wages/Payroll Taxes/Benefits/Contractor Labor,
      COGS, Rent/Utilities/Software/Supplies/Insurance/Office).
- [x] **Ledger library** `src/lib/accounting.ts` — `fmtCents`,
      `centsToDollars`, `dollarsToCents`, `postJournalEntry` (atomic
      draft→post in a transaction), `postDraft`, `reverseJournalEntry`,
      `LedgerError`.
- [x] **API** `GET/POST /api/accounting/accounts`,
      `GET/POST /api/accounting/journal-entries` (POST validates + posts;
      400 with a friendly message on imbalance).
- [x] **Screens**: `/accounting` overview (with live trial-balance check),
      `/accounting/accounts` (chart of accounts list + add form),
      `/accounting/journal` (entry list + dynamic-line create form with live
      balance indicator), `/accounting/journal/[id]` (entry detail with
      post/delete-draft/reverse actions).
- [x] **Nav**: new "Accounting" top-nav group (Overview, Chart of Accounts,
      Journal).

### Phase 2 — Accounts receivable ✅ (PR: accounting-phase-2)

SQL to run in Neon: `docs/sql/accounting_phase2.sql` (idempotent; needs Phase 1
first). Reuses existing `quotes`/`customers` as the invoice source per the
stack decision above — no parallel invoices table.

- [x] **`ar_invoices`** — thin AR posting record wrapping a quote (`quote_id`
      UNIQUE, so one invoice per quote). Totals (`subtotal_cents`, `tax_cents`,
      `total_cents`) are **snapshotted at issue time** so editing the quote
      afterward never mutates a posted invoice. Carries `invoice_number`,
      `invoice_date`, `due_date`, `terms`, `status` (open/paid/void),
      `journal_entry_id`, audit columns.
- [x] **`receipts`** — cash received. Optional `invoice_id` applies it to one
      invoice, else it sits on-account. Carries `receipt_number`, `method`
      (cash/check/card/ach/other), `reference`, `amount_cents`,
      `journal_entry_id`, audit columns.
- [x] **Issue invoice from a quote** auto-posts a balanced entry:
      Dr Accounts Receivable (1100) / Cr Sales Revenue (4000) /
      Cr Sales Tax Payable (2100). Revenue is derived as total − tax so the
      entry always balances even if the quote's stored subtotal drifted.
- [x] **Record receipt** auto-posts Dr Cash (1000) / Cr Accounts Receivable
      (1100). Ledger post + subledger row happen in one DB transaction
      (`postJournalEntryTx`), so either both land or neither does.
- [x] **Per-invoice open balance** = total − receipts applied; status flips
      open⇄paid automatically. Overdue = open + past `due_date`.
- [x] **Void** reverses the invoice's journal entry (history kept) and marks it
      void; blocked once any receipt is applied.
- [x] **API** `GET/POST /api/accounting/invoices`,
      `GET/DELETE /api/accounting/invoices/[id]` (DELETE = void),
      `GET/POST /api/accounting/receipts` — all admin-only via `requireRole`.
- [x] **Screens**: `/accounting/invoices` (list + issue-from-quote form, shows
      outstanding AR and overdue flags), `/accounting/invoices/[id]` (detail,
      receipts applied, balance, record-receipt + void), `/accounting/receipts`
      (list + record form). Overview page gained AR + Receipts cards.
- [ ] Later: split one receipt across multiple invoices (currently one invoice
      or on-account); customer statements.

### Phase 3 — Accounts payable ✅ (PR: accounting-phase-3)

SQL to run in Neon: `docs/sql/accounting_phase3.sql` (idempotent; needs Phase 1
first). Uses the existing `vendors` (and optional `purchase_orders`) tables.

- [x] **`bills`** — a vendor invoice we owe. Carries `bill_number`, `vendor_id`,
      optional `vendor_invoice_number` + `purchase_order_id`, `bill_date`,
      `due_date`, `terms`, `total_cents` (snapshot = sum of lines), `status`
      (open/paid/void), `journal_entry_id`, audit columns.
- [x] **`bill_lines`** — each line posts to a chosen `account_id`
      (expense/asset), with optional `department_id` + `work_order_id` cost
      dimensions and a `description`.
- [x] **`payments`** — cash out. Optional `bill_id` applies it to one bill,
      else on-account. Carries `payment_number`, `method`
      (check/ach/card/cash/other), `reference`, `amount_cents`,
      `journal_entry_id`, audit columns.
- [x] **Create bill** auto-posts a balanced entry: Dr each line's account /
      Cr Accounts Payable (2000) for the total. Ledger post + bill + lines all
      commit in one DB transaction (`postJournalEntryTx`).
- [x] **Record payment** auto-posts Dr Accounts Payable (2000) / Cr Cash (1000).
- [x] **Per-bill open balance** = total − payments applied; status flips
      open⇄paid automatically. Overdue = open + past `due_date`.
- [x] **Void** reverses the bill's journal entry (history kept) and marks it
      void; blocked once any payment is applied.
- [x] **API** `GET/POST /api/accounting/bills`,
      `GET/DELETE /api/accounting/bills/[id]` (DELETE = void),
      `GET/POST /api/accounting/payments` — all admin-only via `requireRole`.
- [x] **Screens**: `/accounting/bills` (list + multi-line create form, shows
      outstanding AP + overdue flags), `/accounting/bills/[id]` (detail, lines,
      payments applied, balance, record-payment + void), `/accounting/payments`
      (list + record form). Overview page gained Bills + Payments cards.
- [ ] Later: split one payment across multiple bills; auto-populate bill lines
      from a linked purchase order's received items.

### Phase 4 — Inventory & cost accounting (pending)

`items`/`inventory_transactions`/`cost_layers`; average (default) + FIFO
costing; receiving posts Dr Inventory / Cr AP-or-Cash; issuing posts Cr
Inventory / Dr WIP-or-COGS. Subledger must reconcile to the Inventory account.
(Note: this project already has `parts`/`part_receipts`/`part_cost_history`
with FIFO+average — Phase 4 should integrate with those rather than duplicate.)

### Phase 5 — Work orders & job costing (pending)

`team_members`, `time_clock_entries`, `work_order_labor`,
`work_order_materials`, job-cost rollup, WIP→COGS on close. (Existing
`work_orders` + `time_entries` integrate here.)

### Phase 6 — Reporting: P&L, job costing, dashboards, aging (pending)

P&L by date range grouped Revenue → Labor (by department) → Other Expenses →
Net, with comparison columns, drill-down, CSV/PDF export; AR/AP aging buckets
(not yet due, 1–30, 31–60, 61–90, 90+); balance sheet from the ledger.

### Phase 7 — AR and AP agents (pending)

Server-side Anthropic calls. AR agent drafts overdue-invoice reminder emails;
AP agent flags bills due / anomalies and proposes a payment schedule. Both
DRAFT only — Approve/Edit/Reject with logging; never act externally on their own.

### Phase 8 — Tax / government tracking (pending)

Track tax liabilities as ledger accounts; period summaries for filings;
visible "confirm with a qualified accountant" disclaimer; **no hardcoded tax
rates** — ask the user for jurisdiction, keep rates configurable.

### Phase 9 — QuickBooks Online integration (LAST — do not start early)

Intuit OAuth 2.0; chart-of-accounts mapping screen; pull payroll labor totals
for P&L reconciliation; one-direction sync into a QBO **sandbox** first, with
explicit user confirmation before any production company; sync log.

### Searchable part picker (shipped)

Requirement: when building quotes / estimates / POs, the team must be able
to **search** for a part (type-ahead) as well as browse — a plain dropdown
won't scale once the catalog is large.

- [x] **`GET /api/parts/search?q=`** — type-ahead lookup matching SKU,
  name, and manufacturer part number; excludes archived; capped at 25
  rows. Empty query returns the first page so it doubles as a browse
  dropdown. Nothing is loaded into the page up front, so it scales to any
  catalog size.
- [x] **`src/components/PartSearchCombobox.tsx`** — reusable server-backed
  combobox (debounced fetch, browse-on-focus, keyboard nav, restricted
  badges, auto-fills price/cost on pick). Two modes: `adder` (pick →
  add a line, box clears) and `inline` (the line's description IS the
  search box; typing edits free text, picking links the part).
- [x] **Quote editor** now uses it for both the top "add a line" control
  and each line's description; the old client-side autocomplete that
  loaded the entire parts table into the page is gone.
- [x] **PO editor** lines are now the searchable combobox instead of a
  dropdown.
- Both the quote and PO pages no longer query the full `parts` table on
  load.

No schema change.

## Notes on building order

When extending a feature, re-read this file first. When adding a NEW
requirement during a build session, append it here in the same commit
so future sessions pick it up.
