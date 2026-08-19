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
- [x] **Vehicle (VIN decoder) per quote.** The quote editor has a
      Vehicle card: VIN input + "Decode VIN" (NHTSA vPIC via
      `/api/vin/decode/[vin]`) auto-fills year / make / model / trim
      (each editable). Plus a free-text **Unit #** field
      (customer/agency-assigned, unique to them, no validation). Stored
      on the quote (`vin`, `vehicle_year`, `vehicle_make`,
      `vehicle_model`, `vehicle_trim`, `unit_number`), so the exact car
      ties to the quote and — on conversion — the invoice (same row).
      `resolveVehicleLabel()` now prefers the quote's own vehicle over
      the deal's, so the upfit spec + quote/invoice PDF + print view all
      show it (VIN + Unit # included).

      Schema (run in Neon):
      ```sql
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vin text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vehicle_year integer;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vehicle_make text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vehicle_model text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vehicle_trim text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS unit_number text;
      ```
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
- [x] **Quote totals foot to the penny** (2026-08-06). Fixed a $0.01 gap where the grand total summed un-rounded per-line discounts (sum-then-round) while the displayed line totals were rounded (round-then-sum). New shared `src/lib/quoteTotals.ts` (`lineDiscount`/`lineNet`/`quoteTotals`) rounds each line before summing; used by the editor, save path, print view, and PDF so the rows always add up to the total. Print/PDF derive the grand from the rounded components + stored tax, so even un-re-saved quotes foot.
- [x] **Original vs discounted price per line on the customer copy** (added
      2026-08-06). So customers can see the discount being given, each discounted
      item line now shows its pre-discount line total struck through above the
      discounted line total, on both the HTML print view and the PDF (quote and
      invoice variants). Undiscounted lines are unchanged (single total). The
      existing Discount column still shows the amount/percent. This pairs with
      the package bundle price, which populates those per-line discounts.
- [x] **Add a new part (with part #) inline from a quote/PO line + duplicate
      guard** (2026-08-06). The shared `PartSearchCombobox` (used by quote and PO
      line editors) now offers "＋ Add new part … to inventory" when typing. It
      opens an inline form (Part # / name / cost / sell), POSTs to `/api/parts`
      to create the part, and adds it to the line. `POST /api/parts` now rejects
      a duplicate SKU with HTTP 409 and the message **"duplicate part number
      detected, add appropriate part number"**, which the combobox shows as a
      popup (`window.alert`) and inline — so a clashing part number can't be
      silently created. Gated by an `allowCreate` prop (default on).
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
  - **Lenient by default** (added 2026-08-04, from real vendor/package sheets
    that don't carry every field). The import imports what it can and reports
    the rest instead of failing:
    - **Only `sku` is required** — it's the identity we upsert on and can't
      invent (a generated SKU would duplicate on every re-upload). A missing
      SKU *column* is still fatal, with a message naming the accepted labels;
      a row missing its SKU *value* is skipped-and-listed, not file-fatal.
    - **`name` is optional** — falls back to the description, then the SKU.
      New aliases: `part_description`/`part_desc`/`item_description` →
      description; `unit_cost` → internal cost; `sell_price`/`unit_price` →
      price; `section` → category; `brand` → manufacturer.
    - **Numbers coerce, never fail** — an unparseable cost/qty defaults and
      logs a warning; the row still imports.
    - **Structural rows** (blank lines, section dividers like
      `SEATING & PRISONER AREA` with no SKU or data) are dropped silently.
    - Defaults/coercions surface as **warnings** in the preview (nothing is
      silently changed). A **Strict mode** checkbox promotes every warning to
      a skip, for a deliberate clean catalog load. The `strict` flag is sent
      to `POST /api/parts/import`.
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
      component grouped by package name; upserts by name. Sample template +
      column docs in the import UI.
  - **Lenient by default** (added 2026-08-04, same rationale as the inventory
    importer — real vendor/package templates lack a `component_type` column
    and don't carry every field):
    - **Only a package-name column is required** (`package_name` /
      `template_name` / `package` / `name`). A blank name cell **inherits the
      row above**, matching section templates that print the title once.
    - **`component_type` is optional and inferred** — no SKU + hours → labor,
      amount-only → fee, else a part; defaults to `item`. Explicit
      `part`/`labor`/`fee` still honored.
    - **Unresolved part SKUs still import** — the component is kept linked by
      SKU snapshot with `partId = null` (the data model already allowed this),
      so a package can reference a part not yet loaded into inventory. Was
      previously a hard error.
    - **A bad row is dropped and reported, not the whole package** — reversing
      the old "any errored row skips the bundle" behavior. A package is only
      skipped if it has no name or zero usable components.
    - **Structural rows** (blank lines, section dividers like
      `SEATING & PRISONER AREA`) are dropped silently; unparseable numbers
      coerce with a warning. Defaults/coercions/dropped rows surface as
      per-package **warnings** in the preview.

### CSV columns (package import)

Only `package_name` (or `template_name`/`package`/`name`) is required.
Optional: `component_type` (`part`/`labor`/`fee`, inferred if absent),
`package_category`, `package_description`, `sku`/`part_number`,
`label`/`part_description` (line description; part rows default to
`SKU — name`), `quantity`/`qty`, `unit_price`/`sell_price` (blank part price
defaults to the part's inventory price), `hours`, `rate`, `amount`.

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

**Bundle/deal price (added 2026-08-06) — run in Neon's SQL Editor:**

```sql
ALTER TABLE packages ADD COLUMN package_price numeric(12,2);
```

**Promo→package link (added 2026-08-06) — run in Neon's SQL Editor:**

```sql
ALTER TABLE packages ADD COLUMN source_promo_id uuid REFERENCES vendor_promo(id) ON DELETE SET NULL;
```

**Package markup / cost model (added 2026-08-06) — run in Neon's SQL Editor:**

```sql
ALTER TABLE packages ADD COLUMN markup_pct numeric(5,2);
```

- [x] **Markup vs Margin pricing mode on packages** (2026-08-06). The builder's "Apply to sell prices" control now has a mode toggle: **Markup % (on cost)** `sell = cost × (1 + p)`, or **Margin % (off list)** `sell = cost ÷ (1 − p)` — so a "40% off list" dealer-discount price is entered as 40 in margin mode (cost $60 → sell $100 = list). Stored in `packages.pricing_mode` (null = markup). Run: `ALTER TABLE packages ADD COLUMN pricing_mode text;`
- [x] **Cost + markup → sell on packages** (user requirement 2026-08-06;
      terminology: *cost* = internal cost, *sell price* = retail). Package item
      components now carry an internal **cost** per unit (in the `components`
      jsonb — no DDL) distinct from the part's normal average cost, because the
      **promo cost differs**. A package-level **markup %** (`packages.markup_pct`,
      the "vendor margin", default 40% on promo sync) derives each line's sell:
      `sell = cost × (1 + markup)`. The builder shows editable Cost + Sell
      columns, a Markup field with "Apply to sell prices", and a live
      cost/sell/margin summary. On a quote the sell prices are used and the promo
      cost is carried onto the line for margin/reporting; sales still add
      case-by-case discounts on the quote (existing mechanics).
- [x] **"Add to Packages" from a vendor promo** (added 2026-08-06). Vendor promos
      (buy side) weren't searchable/quotable; only sales packages are. An
      "Add to Packages" action on `/vendor-promos` materializes a sellable
      package via `syncPromoToPackage()` in `src/lib/promos.ts`: each line's
      internal **cost** = the promo's allocated unit cost (à la carte when the
      promo isn't priced), **sell** = cost × (1 + markup) at the package markup
      (default 40%). Linked via `packages.source_promo_id` (idempotent re-sync),
      opens in the builder to tune markup/sell, and shows a "promo" badge on the
      `/packages` list. Keeps buy/sell separate (PROMO_PACKAGES.md §0).

- [x] **Sell-side bundle/deal price on a package** (added 2026-08-06). Fixes
      "adding a promo package to a quote doesn't discount/allocate anything":
      sales `packages` stored only à la carte line prices, and by design
      (`PROMO_PACKAGES.md §0`) the purchase-side `vendor_promo` allocation must
      not bleed onto customer quotes. So packages gained an optional
      `package_price` — the customer's deal price for the package's PART lines.
      When set, dropping the package on a quote allocates it across the part
      lines as per-line `$ off` discounts so their line totals sum to it exactly
      (labor/fees quote separately); when blank, behavior is unchanged (à la
      carte). Reuses the Phase-3 allocation engine (`allocatePromo`) on the sell
      basis via `expandPackageWithBundlePrice()` in `src/lib/packages.ts`;
      refuses a price above the à la carte parts value (adds the lines
      undiscounted and tells the rep why). Settable on the package builder (live
      saving preview) and via the import column
      `package_price`/`promo_price`/`bundle_price` (package-level, first row that
      supplies it wins). Surfaced on the `/packages` list under the total price.
      This supersedes the deferred item below for the itemized case.

### Deferred (post Packages v1)

- **Fixed-price bundle option** (single-line package price) as an alternative
  to the itemized roll-up, chosen per package. (Partly addressed 2026-08-06 by
  the sell-side bundle price above, which keeps the itemized lines but allocates
  a deal price across them; a single-collapsed-line variant is still open.)
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

## Part # column + discounted-price margin/markup (added 2026-08-06)

- [x] **Part number is its own column** (not under the description) on the PO
      editor line grid and the package builder parts grid — an editable Part #
      input per line (so a number can be typed manually), with a header label.
      The PO PDF already carried a Part # column.
- [x] **Margin/markup reflect cost → retail → discounted price.** The package
      builder summary now shows **Cost (we pay)**, **Retail (list)**, and the
      **Discounted price** (the bundle/promo price when set, else retail, with
      the $ off retail), then **Margin** = discounted − cost (over the discounted
      sell, %) and **Markup** = (discounted − cost)/cost. The `/packages` list
      margin likewise uses the discounted bundle price when one is set, else the
      retail sell.

## Purchase-order status workflow (added 2026-08-06)

Statuses the user set: **Pending** (needs to be placed) → **Ordered** (placed
with the vendor) → **Received** (some parts in) → **Fulfilled** (all parts &
quantities received). Pending/Ordered are chosen by hand when creating or
editing a PO; Received/Fulfilled are set **automatically** by receiving.

**Schema (run in Neon's SQL Editor):**

```sql
ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'ordered';
ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'fulfilled';
```

- [x] Added `ordered` + `fulfilled` to the `purchase_order_status` enum
      (additive; legacy `pending_review`/`po_received`/`received` still render).
- [x] Shared vocab in `src/lib/poStatus.ts` (labels, colors, the manual-choice
      list) used by the list, detail, editor, and filter so they agree. Display:
      `partially_received` → "Received", `fulfilled` → "Fulfilled".
- [x] **Create** (`/purchase-orders`) and **edit** (`POEditor`) expose a status
      picker limited to Pending/Ordered; once receiving starts the status is
      shown read-only (auto-managed), and a plain save never downgrades a
      received/fulfilled PO.
- [x] **Receiving** (`receivePurchaseOrder` in `src/lib/inventory.ts`) sets
      `partially_received` on a partial receipt and `fulfilled` when every line's
      full quantity is in.
- [x] Downstream gates updated for `fulfilled`: dashboard "arriving soon" /
      "late vendor" / "received this month", procurement parts-to-order on-order
      subtraction, work-order cross-PO stock math, and the PO PDF RECEIVED
      watermark.

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
  labor cost per work order). ~~Labor rate: `src/config/labor.ts`
  (`DEFAULT_LABOR_RATE_USD_PER_HOUR = 95`).~~ **Superseded** — rates now
  come from the `labor_rates` table via `src/lib/laborRates.ts`; see
  "Labor cost per build" below.
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

### Phase 4 — Inventory & cost accounting ✅ (PR: accounting-phase-4)

**No schema change** — integrates with the existing `parts` / `part_receipts`
(the FIFO layer table) / `part_cost_history` rather than adding
`items`/`inventory_transactions`/`cost_layers`. The existing FIFO layers ARE
the subledger. Only Phase 1's chart of accounts is required.

- [x] **Ledger hooks** (`src/lib/inventoryLedger.ts`) fire inside the existing
      transactional inventory movements (`src/lib/inventory.ts`):
      - **Receiving a PO** → Dr Inventory (1200) / Cr Accounts Payable (2000),
        valued at PO unit cost.
      - **Issuing parts to a build** (`consumeWorkOrderParts`) → Dr Work in
        Progress (1300) / Cr Inventory (1200) at the exact FIFO cost drained,
        tagged with `work_order_id` for job costing. (Phase 5 moves WIP → COGS
        on job close.)
      - **Restoring a build** (`restoreWorkOrderParts`) → the reverse, at the
        same FIFO cost refilled.
- [x] **Non-fatal by design**: hooks resolve all needed accounts first and skip
      posting entirely if any is missing, so core inventory keeps working with or
      without the accounting module. Never posts a one-sided entry. "Missing"
      covers BOTH the chart of accounts being unseeded AND the accounting schema
      never having been installed at all — `resolveAccountId` probes with
      `to_regclass('gl_accounts')` (returns NULL, never raises, for an absent
      relation) before selecting, because a bare SELECT against a missing
      `gl_accounts` would raise and abort the shared inventory transaction. That
      abort is what surfaced as an "Application error: a server-side exception"
      when clicking **Receive** on a PO in an environment where
      `accounting_phase1.sql` had not been run.
- [x] **Reconciliation** (rule #6): `/accounting/inventory` shows the FIFO
      subledger value (Σ `quantity_remaining × unit_cost`) vs the posted
      Inventory (1200) ledger balance, per-part valuation, and a tie/diff badge.
- [x] **Opening balance / adjustment**: one-click action books the current
      subledger↔ledger difference to Owner's Equity (3000) so the ledger catches
      up to stock that existed before accounting went live. No-ops once they tie.
- [x] **Costing method**: FIFO (the existing layer engine); `average` is also
      already tracked in `part_cost_history`. Values are integer cents.
- [ ] Later: choose Cr Cash instead of AP for cash purchases; GR/IR clearing +
      PO→bill three-way match so a Phase-3 inventory bill nets against the
      receipt accrual instead of double-booking AP.

### Phase 5 — Work orders & job costing ✅ (PR: accounting-phase-5)

SQL to run in Neon: `docs/sql/accounting_phase5.sql` (adds
`work_orders.cogs_journal_entry_id` + a `labor_rates` table; needs Phase 1).
Integrates with the existing `work_orders` + `time_entries` rather than adding
`team_members`/`time_clock_entries`/`work_order_labor`/`work_order_materials`.

- [x] **Materials** need no new plumbing — parts issued to a build already post
      to Work in Progress (1300) tagged with `work_order_id` (Phase 4). Job
      costing reads the per-WO WIP balance straight off the ledger.
- [x] **Labor** derived from the existing time clock (`time_entries` hours on
      closed punches) valued at an hourly **cost rate**. `labor_rates` holds a
      per-user rate plus a shop-wide default (`user_id` NULL). Labor is
      informational for the rollup and expensed via payroll — **not** posted to
      the ledger again (no double-count of wages).
- [x] **Job-cost rollup** (`src/lib/jobCosting.ts`): per work order — materials
      (WIP + already-settled COGS, tagged to the WO), labor hours × rate, total
      cost, and remaining WIP. `listJobCosts()` is set-based (no N+1).
- [x] **WIP → COGS settlement**: `settleJobToCogs` posts Dr COGS (5100) /
      Cr WIP (1300) for the job's current WIP balance, latched by
      `work_orders.cogs_journal_entry_id` so it can't double-post; `reopenJob`
      reverses it.
- [x] **Screens**: `/accounting/job-costing` (list with materials/labor/total/
      WIP/settled), `/accounting/job-costing/[id]` (rollup + labor-by-tech +
      settle/reopen), `/accounting/labor-rates` (set default + per-tech rates).
      Overview page gained a Job costing card.
- [ ] Later: auto-settle WIP → COGS when a work order is marked complete
      (currently a manual admin action); absorb labor into WIP via a
      labor-applied clearing account for full job absorption costing.

### Phase 6 — Reporting: P&L, job costing, dashboards, aging ✅ (PR: accounting-phase-6)

**No schema change** — all read-only, computed from posted journal lines
(`src/lib/reports.ts`).

- [x] **Profit & Loss** (`/accounting/reports/pnl`) by date range, grouped
      Revenue → Labor (by department) → Other Expenses → Net. **Comparison
      column** = the immediately-preceding period of equal length.
      **Drill-down**: each revenue/expense account links to its ledger detail
      (`/accounting/reports/ledger/[code]`) showing the transactions.
      **CSV export** via `/api/accounting/reports/pnl/csv`.
- [x] **Balance sheet** (`/accounting/reports/balance-sheet`) as of any date:
      Assets / Liabilities / Equity from account balances, with current-period
      net income folded into equity and an Assets = Liabilities + Equity check.
- [x] **A/R aging** (`/accounting/reports/ar-aging`) and **A/P aging**
      (`/accounting/reports/ap-aging`): open invoices/bills bucketed
      not-yet-due / 1–30 / 31–60 / 61–90 / 90+ by days past due, with bucket
      totals and a grand total.
- [x] Reports index at `/accounting/reports`; overview page gained a Reports
      card. Job-costing rollup already shipped in Phase 5.
- [ ] Later: PDF export of the statements (react-pdf infra already in the repo);
      dashboard tiles/charts on the accounting overview.

### Phase 7 — AR and AP agents ✅ (PR: accounting-phase-7)

SQL to run in Neon: `docs/sql/accounting_phase7.sql` (adds the `agent_drafts`
table). **Also set `ANTHROPIC_API_KEY` in the Vercel project env** — without it
the screens load and show a "not configured" hint instead of erroring. Uses
`@anthropic-ai/sdk` (added as a dependency) with `claude-opus-4-8`.

- [x] **Server-side Claude calls only** (`src/lib/agents.ts`) — the key is read
      from `process.env.ANTHROPIC_API_KEY` on the server; the browser never sees
      it. `agentsConfigured()` gates the UI.
- [x] **AR agent** `draftArReminder(invoiceId)` — drafts an overdue-invoice
      reminder **email** from the invoice's real facts (customer, balance, days
      past due). Prompt forbids inventing links, fees, or legal threats. Fast
      path (no thinking).
- [x] **AP agent** `draftApSchedule()` — reads all open bills (via the Phase 6
      aging query), flags anomalies (past due, outliers, possible duplicates,
      clusters) and proposes a prioritized payment schedule. Adaptive thinking.
- [x] **DRAFT only, never acts externally**: every result is an `agent_drafts`
      row with status `pending`. Approving records an **internal sign-off** — it
      does not send the email or schedule the payment; those stay manual.
- [x] **Approve / Edit / Reject with logging**: the review page lets an admin
      edit the draft text, then Approve or Reject with an optional note;
      `reviewed_by` / `reviewed_at` / `review_note` / `edited_content` are all
      persisted.
- [x] **Screens**: `/accounting/agents` (overdue invoices with "Draft reminder",
      an "Analyze payables" button, and the draft log), `/accounting/agents/[id]`
      (review + approve/edit/reject). Overview page gained an AR/AP agents card.
      All admin-only.
- [ ] Later: actually send approved reminder emails via an email provider (kept
      manual on purpose for now); scheduled/batch drafting of reminders.

### Phase 8 — Tax / government tracking ✅ (PR: accounting-phase-8)

SQL to run in Neon: `docs/sql/accounting_phase8.sql` (adds `tax_rates`). Tax
liability itself lives in the ledger (Sales Tax Payable, 2100, seeded Phase 1).

- [x] **Tax liability tracked as a ledger account** — invoicing a taxed quote
      credits Sales Tax Payable (2100, Phase 2); remitting debits it. No new
      liability table; the ledger is the source of truth.
- [x] **Configurable rates, nothing hardcoded** — `tax_rates` (jurisdiction,
      `rate_pct`, active flag, notes) managed at `/accounting/tax/rates`. The
      team enters jurisdictions and rates; the code hardcodes none.
- [x] **Period filing summary** (`src/lib/tax.ts` → `taxSummary`) computed from
      the 2100 ledger: opening liability, collected this period (credits),
      remitted this period (debits), closing liability — for any date range.
- [x] **Record a remittance** posts Dr Sales Tax Payable / Cr Cash, so paying
      the authority draws the liability down in the ledger.
- [x] **Accountant disclaimer** shown on every tax screen ("bookkeeping summary,
      not tax advice — confirm with a qualified accountant").
- [x] **Screens**: `/accounting/tax` (summary + remittance form) and
      `/accounting/tax/rates` (manage rates). Overview page gained a Tax card.
      All admin-only.
- [ ] Later: per-jurisdiction liability breakdown (needs a jurisdiction tag on
      journal lines); auto-applying configured rates on the quote side.

### Phase 9 — QuickBooks Online integration ✅ (PR: accounting-phase-9)

SQL to run in Neon: `docs/sql/accounting_phase9.sql` (adds `qbo_settings`,
`qbo_account_map`, `qbo_sync_log`). **To actually connect**, set
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` in the Vercel env and
register the redirect URI in your Intuit developer app. Without them the screens
load and say "not configured" (`qboConfigured()` gates the UI).

- [x] **Intuit OAuth 2.0** (`src/lib/qbo.ts`): `beginAuth()` builds the Intuit
      authorize URL with a CSRF `state`; the callback route
      `/api/accounting/quickbooks/callback` verifies state and exchanges the
      code for tokens (Basic-auth to Intuit's token endpoint), storing
      access/refresh tokens + `realmId`. Admin-only. Standard flow; must be
      exercised against a real Intuit app + sandbox to confirm end-to-end.
- [x] **Chart-of-accounts mapping** (`/accounting/quickbooks/mapping`): every
      active `gl_account` → a QBO account name/id, stored in `qbo_account_map`.
- [x] **Payroll labor import for P&L reconciliation**: enter labor totals per
      department (from the payroll report) → posts Dr Wages (5000) per
      department / Cr Cash (1000), landing labor in the P&L labor section. Auto-
      pull from QBO is the future step once a live connection is proven.
- [x] **Sandbox-first + explicit production confirmation**: environment defaults
      to `sandbox`; switching to `production` requires ticking a confirm box and
      disconnects the current session. Sync is one-direction into QBO.
- [x] **Sync log** (`qbo_sync_log`, `/accounting/quickbooks/sync-log`): every
      connect/disconnect/mapping/import/environment change is recorded.
- [x] **Screens**: `/accounting/quickbooks` (status, connect/disconnect,
      environment, payroll import), `/mapping`, `/sync-log`. Overview page gained
      a QuickBooks card. All admin-only.
- [ ] Later (needs live Intuit credentials to build+verify safely): token
      auto-refresh, fetching the QBO account list into the mapping dropdown,
      pushing journal entries to QBO, and pulling payroll totals automatically.

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

## Promo packages, cost layers, reservations & backfill (brief 2026-08-03)

Whelen (and vendors like them) sell most of our lighting as discounted
**packages** — one price for a fixed basket of parts — while we also buy
those same part numbers individually at full price. This build makes both
work under one SKU. Full brief, phase plan, and the Phase 0 audit map live
in **`docs/PROMO_PACKAGES.md`**; read that before touching any of it.

Four governing ideas:

1. **One SKU, one bin.** A part is never split into a "promo" SKU and an
   "individual" SKU. One `parts` row, one on-hand count.
2. **Cost lives in layers.** Every receipt creates a cost layer with its own
   unit cost and provenance; on-hand is the sum of the layers. The existing
   `part_receipts` table already is this — extend it, don't duplicate it.
   **Weighted average is the primary costing basis** for work orders (see
   below); layers still back it, and FIFO stays available as a second
   valuation.
3. **A package price is allocated across its parts**, in proportion to each
   line's à la carte cost, so every part carries a fair share of the
   discount. **Package purchases only** — allocation must be unreachable
   from an individual PO line.
4. **Claims, not separate bins.** A sold build reserves the parts it needs;
   everyone else pulls against available (= on-hand − reserved).

Ground rules for every phase:

- Money is `numeric(12,2)`, never `real`/`float`/`double`. (Audit found no
  float money columns; the exposure is money stored inside `jsonb` line
  items — see `docs/PROMO_PACKAGES.md` §0.2.)
- Multi-step money writes go in one Drizzle transaction.
- **Snapshot, don't reference-live.** Promo lines snapshot the à la carte
  cost at definition; PO lines snapshot the allocated cost at PO time. Later
  price-list edits never retroactively change a placed PO or a used promo.
- Allocation lives in exactly one code path, callable only with a
  `vendor_promo`.
- Receiving is idempotent — a receipt key or unique constraint, not just a
  row lock.
- Never edit a posted journal entry; corrections are reversing entries.

Phases (one at a time, approval between each):

- [x] **Phase 0 — Guardrails and inventory audit.** Written map of the real
      tables, money-column types, on-hand storage, and current PO/receiving
      behaviour. No code changes. Result: `docs/PROMO_PACKAGES.md` §0.
- [x] **Phase 1 — `vendor_part_price`**, the à la carte cost basis.
      Date-ranged rows per (vendor, sku); a price change adds a row rather
      than overwriting, so historical POs stay explainable. This list — not
      `parts.cost` — is what individual PO lines pre-fill from, so a
      discounted package receipt can't leak into the next full-price order.
      Delivered: `vendorPartPrice` table (schema + `docs/sql/promo_phase1.sql`,
      partial unique index enforcing one current price per vendor+sku);
      `src/lib/vendorPricing.ts` resolver (`currentAlacarteCost`,
      `priceHistory`, transactional `setCurrentPrice` that closes-and-appends);
      `/api/vendor-part-prices` route pair; `/vendor-pricing` admin screen
      (set-price form + current/history views) wired into Operations nav.
      SQL seeds the two à la carte costs the brief states (XI3JC 112.00,
      TCRWX6 1282.80); the rest of the Whelen sheet is loaded via the screen —
      not fabricated, so Phase 3's reconciliation stays honest.
- [x] **Phase 2 — Cost layers + average/FIFO consumption.** Extend
      `part_receipts` with `source_kind`/`promo_id`, add `inventory_issue`
      rows, a general `issue(sku, qty, workOrderId?)`, and opening-balance
      layers for stock that predates the layer table. Add `parts.avg_cost`
      `numeric(12,4)` as a moving average maintained on receipt, a one-row
      `costing_policy` table (default `weighted_average`), and make
      `inventoryValuation.ts` method-aware. Issuing drains layers oldest-first
      for quantity and provenance but charges the job at average cost.
      **`parts.cost` auto-updates from `avg_cost`** (= `ROUND(avg_cost, 2)`,
      relabelled "Average cost" on the form, still editable for opening
      values); `avg_cost` `numeric(12,4)` is the authoritative average and
      `parts.cost` `numeric(12,2)` its operational reflection. Both update at
      receipt, in the receive transaction, never at PO entry. On
      quote→invoice conversion, snapshot `avg_cost` onto the line items so the
      internal margin view reflects cost at sale, not today's average.
- [x] **Phase 3 — `vendor_promo` / `vendor_promo_line` + the allocation
      engine.** Pure, deterministic, unit-tested; rounding plug ties the
      allocation to the package price exactly; refuses any promo whose
      allocated unit cost exceeds its à la carte snapshot.
- [x] **Phase 4 — POs apply the package; receiving writes layers.**
      Allocation runs once at PO creation (Whelen ships partial, so a
      partial receipt needs a cost already on the line). Individual POs
      never call it. PO lines stayed jsonb (extended, not promoted to a
      table — see PROMO_PACKAGES.md decision #5).
- [x] **Phase 5 — `inventory_reservation` + available-to-pull.** Reservations
      fire when a work order enters `confirmed` (customer PO in hand, build
      committed to the shop) — one `reserveForWorkOrder` called from
      `maybePromoteWonDeal` and the `/workflow` board path. Every picking
      screen reads available, never raw on-hand.
- [x] **Phase 6 — Reorder points, reserved-stock override, auto-backfill.**
      Pulling reserved stock requires an override that logs who/why and
      raises its own replacement requisition.
- [x] **Phase 7 — Promo vs backfill savings report.** Did the package
      discount survive the backfill spend? Must be built from the layer
      table's `source_kind` + per-layer `unit_cost`, **not** from job costing
      — under average costing the promo saving is smeared into the average
      and is invisible in work-order cost by construction.

Decisions settled 2026-08-03: weighted average primary / FIFO secondary;
reservations fire on the `confirmed` transition; Whelen pays no rebates so
there is no rebate-to-cost mechanism. Still open: whether PO lines stay
`jsonb` or get promoted to a `purchase_order_line` table (Phase 4;
recommendation is to promote). Full reasoning in `docs/PROMO_PACKAGES.md`.

## Labor cost per build — one rate source, from actual clocked time

**Requirement (user, this session):** the labor cost of a build must be
driven by the actual hours clocked against that specific work order, and
by one authoritative rate — not by a hardcoded number.

### What was wrong

Two independent labor-cost calculations disagreed:

- `src/config/labor.ts` hardcoded `DEFAULT_LABOR_RATE_USD_PER_HOUR = 95`,
  read by `laborByWorkOrder()` in `src/lib/timeclock.ts` and shown on
  `/work-orders/[id]`. It grouped by work order only, so every tech on a
  build cost the same.
- The `labor_rates` table (per-user + shop default, Phase 5) was read by
  `src/lib/jobCosting.ts` and drove `/accounting/job-costing`.

Measured on a seeded build — Senior 10 h @ $120 + Apprentice 10 h @ $40:
the work-order page reported **$1,900** (20 h × $95) while job costing
reported **$1,600**. Worse, `defaultLaborRateCents()` returned `0` when
the shop-default row was never seeded, so job costing silently reported
**$0** labor, and `listJobCosts()` then skipped such jobs entirely
because it tested labor *cost* rather than *hours*.

### What is true now

- [x] **`src/lib/laborRates.ts` is the only place a cost rate resolves.**
  `loadLaborRates()` reads the table once; `rateForUser()` returns the
  user's override, else the shop default, else `"unset"`. A rate of `0`
  is treated as not-filled-in and falls through.
- [x] **`src/config/labor.ts` is deleted.** No hardcoded rate exists.
- [x] **Cost derives from real punches per build, per tech.**
  `laborByWorkOrder()` groups by `(work_order_id, user_id)` and values
  each person's hours at their own rate. Only closed punches count.
  It accepts an optional `workOrderId` so a single build can be costed
  without scanning the shop.
- [x] **Both sides use one hours expression** (`CLOCKED_SECONDS_SQL`) and
  round per tech per job, so the per-tech rows add up to the job total
  and the two screens agree by construction.
- [x] **"No rate" is visible, never silently $0.** `missingRate` /
  `rateSource` flow through `WorkOrderLabor`, `LaborEntry`, and
  `JobCost`; `/work-orders/[id]`, `/timeclock`,
  `/accounting/job-costing`, and its detail page all say so and link to
  `/accounting/labor-rates`, which warns when no shop default exists.
- [x] **A job with clocked hours but no rate still lists** —
  `listJobCosts()` keys the skip on hours, not cost.

These are **cost** rates (what a build costs us). What we *bill* for
labor is entered per quote line in the quote editor and is deliberately
unrelated — never use one for the other or margins go wrong.

### Not done here (needs a decision)

Labor still does **not** post to the ledger against a job. WIP holds
materials only; the sole path into the books is the manual QBO payroll
import (`src/lib/qbo.ts`), which posts Dr Wages / Cr Cash with no
`work_order_id`. Posting labor to WIP would double-count against that
import unless one of the two is made authoritative first. See P1 item
D-1 in `audits/audit-2026-08-03.md`.

### SQL to run in Neon

`labor_rates` already exists (Phase 5), so no table is added. Two things
still need running once — seeding the shop-default rate, and adding an
index that Phase 5 left out.

The gap: `labor_rates_user_uidx` is `UNIQUE (user_id)`, and Postgres
treats NULLs as **distinct**, so that index never constrained the
shop-default row. Nothing stopped several default rows existing, and
`ON CONFLICT (user_id)` silently does not fire for them — an
`INSERT ... ON CONFLICT` run twice creates two defaults. App code now
resolves the most-recently-updated one so behaviour is at least
deterministic, but the index below is the real fix.

Safe to run more than once:

```sql
-- Collapse any duplicate shop-default rows, keeping the newest.
DELETE FROM labor_rates
 WHERE user_id IS NULL
   AND id <> (SELECT id FROM labor_rates WHERE user_id IS NULL
              ORDER BY updated_at DESC, created_at DESC LIMIT 1);

-- Enforce at most one shop-default row from here on (Phase 5's
-- UNIQUE (user_id) does not cover NULL).
CREATE UNIQUE INDEX IF NOT EXISTS labor_rates_single_default_uidx
  ON labor_rates ((user_id IS NULL)) WHERE user_id IS NULL;

-- Shop-wide default hourly COST rate. Written in DOLLARS in one place;
-- rate_cents is integer cents, so it is converted here rather than making
-- you do the arithmetic. $95.00 matches the old hardcoded constant, so
-- nothing shifts on day one. Or just set it at /accounting/labor-rates.
WITH rate AS (SELECT ROUND(95.00 * 100)::bigint AS cents)
UPDATE labor_rates SET rate_cents = (SELECT cents FROM rate), updated_at = now()
 WHERE user_id IS NULL;

WITH rate AS (SELECT ROUND(95.00 * 100)::bigint AS cents)
INSERT INTO labor_rates (user_id, rate_cents)
SELECT NULL, (SELECT cents FROM rate)
 WHERE NOT EXISTS (SELECT 1 FROM labor_rates WHERE user_id IS NULL);
```

Until the rate is set, every screen says so rather than reporting $0 as
though it were real.

## Themes — Dark / Black / Day

**Requirement (user, this session):** three selectable themes. Dark stays as
it was but with type ~2pt larger and a little bolder. Black = black
background, white and other soft-toned fonts, bold. Day = tan/cream
background with black/navy fonts.

Selected by `data-theme` on `<html>`; all values live in
`src/app/globals.css`. `src/lib/theme.ts` holds the theme list and the
bootstrap script; `src/components/ThemeToggle.tsx` is the header control.

### The header control (user, this session)

A single **sun/moon icon button**, top-right next to the notification bell —
requested in place of the original three-way Dark/Black/Day segmented
control. The icon shows what you'll *get*, not where you are: a sun means
"click for day".

There are three themes but only one moon, so **the night side resolves to
whichever dark theme was last used** (`chiefs-theme-night` in
localStorage, default `dark`). Someone on Black who flips to day and back
returns to Black rather than being silently moved to Dark. Black therefore
has no UI to reach it from Day — switching a browser's night side to Black
means setting `chiefs-theme` to `black` once (dev tools, or
`localStorage.setItem('chiefs-theme','black')`), after which the toggle
remembers it. If Black needs to be pickable again, that is a third state on
this button or a small picker elsewhere.

### How it re-skins 106 files with no component edits

Tailwind v4 compiles every palette utility to `var(--color-…)` — including
opacity variants, which become
`color-mix(… var(--color-white) 5% …)`. So redefining those variables under
`[data-theme="…"]` changes the whole app at once. Verified against the
Tailwind CLI output before relying on it.

The consequence is that **the palette is now semantic**, and Day inverts it:

| Utility | Means | Day mode |
| --- | --- | --- |
| `text-white` | primary foreground | navy ink `#0d1b33` |
| `text-zinc-200…700` | muted ramp | **inverted** — lower number = darker |
| `bg-white/5`, `/10` | raised surface, hairline border | subtle navy wash |
| `bg-black/20`, `/40` | recessed (inputs) | paper `#fffdf6` |
| `bg-surface` | card background | `#fbf6ea` |
| `amber-*` | brand accent | burnt amber, darkened |

**When adding colour to a component, use a slot that already exists.** A
literal hex will not follow the theme. The 161 old `bg-[#161624]` /
`bg-[#0f0f1a]` usages were replaced with `bg-surface` / `bg-surface-2` for
exactly this reason, and there are now no arbitrary hex colours in `src/`.

### Type

`--type-bump: 2.67px` (≈2pt) is added to every size, additively so the
hierarchy keeps its proportions. Tailwind's line-heights are unitless
ratios, so they follow automatically. 584 literal `text-[Npx]` usages span
only five distinct values, so five unlayered rules scale them all.
`--font-weight-*` is set per theme: Day lightest, Dark middle, Black
heaviest (dark ink on cream already reads heavy; 700+ there turns muddy).

### Display font weight is capped — do not remove this

**Syne is a variable font with a 400–800 weight axis, and its glyphs widen
sharply along it.** Measured at one size, weight 780 renders **~35% wider**
than 700 — "Chiefs Pursuit Surplus" at 332px vs 246px. So the app-wide weight
bump, which is correct for DM Sans, stretched every heading and made figures
like `PO-4640938 · $13,531.25` hard to read.

`.font-display` therefore redefines `--font-weight-*` locally (bold 650,
semibold 600) plus `letter-spacing: -0.02em`. This works because a custom
property resolves from the element it is used on, so the `font-bold` utility
on a `.font-display` element picks up the local value rather than `:root`'s.
Result is 228px — narrower than even the original 700 — while keeping Syne's
character.

Display weight is deliberately **theme-independent**: letting it vary per
theme would reintroduce width differences between themes. If the headings
ever need adjusting, change those three numbers rather than the `:root`
weights, or the stretching comes back. No `.font-display` element uses a
`tracking-*` utility, which is what makes setting letter-spacing there safe.

### Contrast

Black and Day were measured with a real contrast check (resolving `oklch`,
which Tailwind emits by default) and have **zero** elements below 4.5:1.
Getting there required lifting the faint end of both zinc ramps off a
"natural" curve and darkening the Day ambers — the first pass had the
primary button at 3.5:1 and Day's `text-zinc-600` at 3.5:1.

**Dark is left as-is per the requirement, and it has ~54 elements below
4.5:1** — `text-zinc-500` at 3.7:1 and `text-zinc-600` at 2.32:1 on a card.
That is pre-existing, not introduced here. Two variable overrides in the
dark block would fix it if wanted.

### Exceptions

- `.upfit-canvas` (the vehicle diagram) is literal white in every theme — it
  is a spec sheet that gets printed.
- `@media print` forces ink-on-paper regardless of the active theme.

No schema change. Theme choice is per-browser (`localStorage`), not per-user
in the database — so it does not follow someone to another machine.

## Vendor package-template import (user requirement, 2026-08-05)

**Requirement (user, this session):** import a vendor package template
sheet (e.g. `PIU Whelen Lightbar Regional Promo`) in one pass. Rules the
user stated:

- **One sheet = one sellable package.** Every part line belongs to it —
  lighting, siren, brackets, all sections. Sections are groupings, not
  separate packages.
- **The package price covers ALL parts on the sheet.** In the sample, the
  `Lightbar Regional Promo · $7,200` header row (a price with no part
  number) is the cost of the whole basket, allocated across every part.
- **Not every package has promo pricing** — a sheet with no package-price
  row imports at plain à la carte, no promo. Both cases must work.
- **Promo pricing varies by deal** (regional heavily discounted, national
  and bulk different, and they don't take every promo), so the price is
  always read from the sheet — never computed or assumed.
- **Ignore the Notes column** entirely (it lists Whelen promo codes that
  aren't all used).
- Each part's allocated cost is the **net of its own à la carte cost** —
  parts do not share a price.

### Implementation

- [x] `src/lib/packageTemplateCsv.ts` — pure parser. Alias-matched headers
      (`Template Name`, `Section`, `Part Number`, `Part Description`, `Qty`,
      `Unit Cost`, `Sell Price`, `Install Hrs`); `Line #`, `Discount %`,
      `Extended Sell`, `Notes` ignored. A priced row with **no part number**
      is the package price (or freight, if the label says freight/shipping);
      it is never a component line. Section name infers labor/fee vs item.
      Blank Template Name / Section cells inherit the row above. Structural
      rows drop silently.
- [x] `src/lib/packageTemplateImport.ts` — preview/commit importer. Creates:
      à la carte `vendor_part_price` rows from each part's Unit Cost (via the
      append-only `setCurrentPrice`), ONE `vendor_promo` + lines allocated
      across all parts when the sheet is priced, and the sellable `packages`
      row (items with Sell Price + labor + fees). Missing SKUs are created
      with the sheet's cost/price as opening values. Packages upsert by name.
      **Duplicate SKUs on a sheet are merged for the promo** (summed qty —
      e.g. XI3JC 4 roof + 2 grille = 6) while the sellable package keeps the
      lines separate as distinct placements.
- [x] `POST /api/package-templates/import` `{ csv, vendorId, commit? }`.
- [x] `/packages/import-template` — vendor picker (defaults to a
      Whelen-matching vendor), file/paste, **dry-run preview → confirm**,
      per-template result showing items / new parts / à la carte set /
      promo saving. Linked from `/packages` and the Operations nav.
- [x] **Report hardening:** `promoReport.ts` looked up the à la carte basis
      with a join on `(promo_id, sku)`, which would multiply receipt rows
      when a promo carries the same SKU twice. Now a correlated subquery, so
      duplicate promo lines can't inflate units or cost.

**Verified against the user's real sheet:** 19 part lines → 18 merged promo
lines; basis $11,324.70 → package $7,200.00 = $4,124.70 saved; allocation
ties to $7,200 exactly; every allocated cost ≤ its à la carte; 18 distinct
allocated unit costs (no two parts share a price).

### Deferred

- Labor `rate` and fee `amount` import as 0 when the sheet leaves those
  columns blank (the sample does) — filled in on the package editor.
- Multi-sheet `.xlsx` upload (today: one CSV sheet per import; export each
  tab, or paste it).

## AP: PO receipt / vendor bill double-count (fixed)

**Requirement (user, this session):** fix the P0 from
`audits/audit-2026-08-03.md` where receiving a PO and entering its vendor bill
both credited Accounts Payable.

### What was wrong

Receiving goods and being billed for them are two events against **one**
liability, but both credited AP (2000):

| Event | Old entry |
| --- | --- |
| Receive parts | Dr Inventory 1200 / **Cr AP 2000** |
| Vendor bill | Dr *hand-picked expense* / **Cr AP 2000** |

A $10,000 PO received **and** billed therefore showed **$20,000** owed, and the
cost was booked twice — once as an Inventory asset, once as an expense.

### What is true now

Receipt credits a clearing account; the bill relieves it.

| Event | Entry |
| --- | --- |
| Receive parts | Dr Inventory 1200 / Cr **Accrued Purchases 2050** |
| Bill **against a PO** | Dr **2050** (received value) + Dr **5900** (any excess) / Cr AP 2000 |
| Bill **not** against a PO | Dr chosen expense/asset accounts / Cr AP 2000 *(unchanged)* |
| Pay vendor | Dr AP 2000 / Cr Cash 1000 *(unchanged)* |

Over a full cycle Inventory rises, Cash falls, and 2050 returns to zero. Its
running balance is a useful figure on its own: **goods received but not yet
invoiced**.

- [x] `docs/sql/accounting_phase10.sql` adds `2050 Accrued Purchases (GRNI)` and
  `5900 Purchase Price Variance`; both are also in the phase-1 seed so a fresh
  environment gets them without running phase 10.
- [x] `src/lib/inventoryLedger.ts` — `postInventoryReceipt` credits 2050.
- [x] `src/lib/ap.ts` — `createBill` with a `purchaseOrderId` relieves the
  accrual and routes any excess to variance. **The caller's line accounts are
  overridden on purpose**: the goods are already capitalised in Inventory, so
  debiting an expense here is precisely the double-count being removed. Line
  descriptions/amounts are still kept as bill detail.
- [x] `accruedRemainingForPo()` is the three-way match. "Received" comes from
  `part_receipts` (append-only, priced at arrival) rather than the PO's
  **editable** line items, so a later price edit cannot rewrite history.
  "Already relieved" is prior bills' 2050 debits, not their totals — a bill that
  ran over only relieved part of itself.
- [x] `BillForm` gained the PO picker. Before this, `purchaseOrderId` was never
  sent by any UI, so **no bill was linked to a PO at all** and there would have
  been nothing to trigger the new path. Selecting a PO hides the per-line
  Account/Department pickers (the GL side is determined) and warns when the bill
  exceeds the received value.

**A partial bill is not a variance.** Billing less than was received leaves the
remainder accrued, because another invoice is normally still coming. Only the
*excess* over received value becomes variance. The consequence: if a vendor
permanently under-bills, that residue sits in 2050 until someone clears it —
there is no PO-close to detect "no more invoices are coming" (see the audit's
D-8).

### ⚠️ Sizing what is already posted

Fixing the code stops new double-counts. It does **not** correct entries already
in the ledger. Run this to size the existing overstatement:

```sql
SELECT COUNT(*) AS receipt_entries,
       (SUM(jl.credit_cents)/100.0)::numeric(14,2) AS overstated_dollars,
       MIN(je.entry_date)::date AS first_seen,
       MAX(je.entry_date)::date AS last_seen
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN gl_accounts    g  ON g.id  = jl.account_id
WHERE g.code = '2000'
  AND je.status = 'posted'
  AND je.source = 'system'
  AND je.memo LIKE 'Inventory received%'
  AND jl.credit_cents > 0;
```

Correcting it is one journal entry reclassifying those credits from 2000 to
2050 — **but whether to reclassify or reverse depends on which of those POs were
also billed**, which is a call for whoever signs off on the books. Not posted
automatically, on purpose.

### Unrelated gap found while testing

`part_receipts` has **no `CREATE TABLE` anywhere in the repo** —
`promo_phase2.sql` calls it "the existing FIFO layer table" and only ALTERs it.
A fresh environment cannot be built from the SQL in version control; the table
has to be created by hand first. Worth adding a phase file for it.

## Chart of accounts restructure (accountant's request, 2026-08-06)

The accountant asked for a chart that shows where profit comes from and where
cost goes, rather than a single Materials line and a single Wages line.

### What was asked for

1. **Cost of Goods Sold becomes its own account type**, not an expense
   subgroup, so it gets its own P&L section above gross profit.
2. **COGS split into the components installed on police vehicles** — wire &
   cable, emergency lights, sirens, consoles, partitions, gun locks, mounting
   brackets, radios, cameras, graphics/decals, freight in, shop supplies used on
   jobs.
3. **Contractor labor moves under COGS.**
4. **Direct labor separated from administrative payroll.**
5. **Operating expenses expanded** across 6xxx.
6. **Nobody may choose Normal Balance.** Quoting the request: *"It prevents
   someone from accidentally creating an expense account with a credit balance or
   a liability with a debit balance."*

### The chart

```
4000  Revenue
5000  COST OF GOODS SOLD                     (type `cogs`, above gross profit)
  5100  Vehicle Parts — Uncategorized        ← where unmapped material lands
  5110  Wire & Cable          5170  Mounting Brackets
  5120  Emergency Lights      5180  Radios
  5130  Sirens & Speakers     5190  Cameras
  5140  Consoles              5200  Graphics & Decals
  5150  Partitions            5210  Freight In
  5160  Gun Locks             5220  Shop Supplies Used on Jobs
  5300  Direct Labor — Installers
  5310  Direct Labor — Payroll Taxes
  5320  Contractor Labor
  5900  Purchase Price Variance              (group `cogs_other`)
6000  OPERATING EXPENSES
  6010  Payroll — Administrative    6150  Fuel
  6020  Payroll Taxes — Admin       6160  Vehicle Expense
  6030  Benefits                    6170  Shop Supplies (non-job)
  6100  Office Rent                 6180  Advertising
  6110  Utilities                   6190  Training
  6120  Software Subscriptions      6200  Repairs & Maintenance
  6130  Insurance                   6210  Depreciation
  6140  Office Supplies
```

### Normal balance is derived, in three places

`src/lib/chartOfAccounts.ts` is the single source: asset/expense/COGS → debit,
liability/equity/revenue → credit.

- The form has **no normal-balance input** — it shows the derived value
  read-only (`src/components/accounting/AccountTypeFields.tsx`).
- The API **ignores** any `normalBalance` in the request body and derives it
  (`src/app/api/accounting/accounts/route.ts`).
- A CHECK constraint enforces it for direct SQL
  (`gl_accounts_normal_balance_matches_type`).

A second CHECK (`gl_accounts_report_group_matches_type`) blocks the other way to
create an account that reports nowhere: a P&L account with `report_group =
'none'` appears on **no statement at all**, and a balance-sheet account carrying
a P&L group would be double-counted. Which group beyond that is left to app code,
because historical rows still carry the pre-restructure `labor` /
`other_expense` values and must stay valid.

The report group is also filtered by type in the form, so a COGS account cannot
be filed under operating expenses and end up below gross profit.

### COGS actually splits itself — by part category

Twelve accounts are worthless if nothing posts to them. Material reaches COGS in
exactly one place — the WIP→COGS settlement when a job closes — and that used to
post the whole job as one line to 5100.

- `part_category_accounts` maps `parts.category` (free text) → GL account,
  case-insensitively.
- On settle, `src/lib/cogsCategories.ts :: cogsSplitForWorkOrder` reads the
  job's `inventory_issue` rows, groups their cost by the part's category, folds
  those into accounts via the mapping, and apportions the **WIP balance** across
  them.
- The issue rows are **weights, not amounts**: their `unit_cost` is the FIFO
  layer cost while WIP may have been charged at weighted average, so the totals
  differ. Apportioning by weight with largest-remainder rounding means the split
  always sums to the WIP balance to the cent.
- Unmapped categories (and jobs with no issue detail) land on **5100
  Uncategorized**. A settlement never fails because the mapping is incomplete.
- `/accounting/cogs-categories` edits the mapping and lists what is still
  unmapped; the accounting home shows that count. The job-costing detail page
  previews exactly which accounts a settle would debit, before posting.
- A category can only map to a `cogs_parts` account — enforced in
  `setCategoryAccount`, so the server action and the API can't disagree.

Changing a mapping affects **future** settlements only. Posted entries are never
rewritten.

### Direct vs administrative payroll is entered, not inferred

The QuickBooks payroll import used to post everything to `5000 Wages`. Each
department line now carries a Direct / Administrative choice: direct → `5300`
(COGS, above gross profit), administrative → `6010` (overhead). Lines default to
administrative, because overstating gross profit is the more misleading error.
Only whoever runs payroll knows which departments turn wrenches.

### What was done with the old accounts

Journal lines reference account **ids**, so renaming and renumbering are safe —
history follows the row.

- `6000/6010/6020/6040` (Rent, Utilities, Software, Insurance) → renumbered to
  `6100/6110/6120/6130`. Same rows, new codes, history intact.
- `6030 Supplies` and `6050 Office Expense` do **not** map cleanly — the new
  chart separates office supplies (6140) from non-job shop supplies (6170), and
  nothing in the data says which those lumps were. Moved to `6230/6240`, renamed
  "— legacy (pre-split)" and deactivated rather than relabelled on a guess. If
  you know what they held, reactivate and rename one.
- `5000/5010/5020` (Wages, Payroll Taxes, Benefits) → retired inactive, history
  left in operating expenses. Splitting past payroll between COGS and overhead
  after the fact would restate prior-period gross margin on a guess.
- `5030 Contractor Labor` → retired inactive but regrouped to `cogs_labor`. That
  **is** a reclassification of prior periods, and it is the correction that was
  asked for.
- `5100 Cost of Goods Sold` → retyped `cogs`, renamed `Vehicle Parts —
  Uncategorized`. It held material cost while sitting under `other_expense`,
  which was the "COGS mixed in with expenses" problem itself.

### SQL to run in Neon

`docs/sql/accounting_phase11.sql`, **after** `accounting_phase10.sql`. Safe to
re-run. Two things about it are not cosmetic:

- **Order matters.** The renumbering in step 2 must run before step 5 inserts
  new accounts at `6010/6020/6030`, or past utility bills end up labelled Payroll
  and the new Benefits account silently isn't created.
- **Every renumber is guarded** with `AND NOT EXISTS (… destination code …)`.
  That guard is what makes a second run safe: on re-run, `6010` is the *new*
  Payroll account, and an unguarded rename would collide with Utilities or move
  Payroll into it. Verified idempotent over three consecutive runs.

Step 8 seeds the category mapping by keyword-matching the categories already on
parts — **once, in a file you can read**, not silently at posting time. Anything
it doesn't match is left unmapped and visible in the UI.

### Verified against a real Postgres

`scripts/verify-cogs-split.ts` and `scripts/verify-pnl-cogs.ts` (throwaway
database only — they post entries). They check that the split sums to the WIP
balance exactly at awkward totals, that unmapped categories collect on 5100,
that the settle entry balances and zeroes the job out of WIP, that the rollup
still sees material after a split settle, that a second settle is refused and
reopen restores WIP, that variance stays out of `cogs_parts`, and that the
balance sheet still balances now that `cogs` is its own type. Both pass.

`scripts/scratch-schema-drift.ts` lists columns `schema.ts` declares that a
database lacks — needed because `drizzle/0000_initial.sql` is behind the schema
(see the `part_receipts` gap above).

### Still open

- Direct labor from the **time clock** is not posted to the GL. Clocked hours ×
  cost rate drives the job-cost rollup (see the labor-cost section above), but
  `5300` is fed only by the payroll import. Wiring the clock to the ledger would
  mean deciding how to avoid double-booking it against payroll.
- `5310 Direct Labor — Payroll Taxes` and `5320 Contractor Labor` exist but
  nothing posts to them automatically yet.

## Button feedback (user requirement, 2026-08-06)

> "all of these buttons have no feedback when pressing the buttons. It works and
> is functional to save but the button is still and hard and you cannot tell if
> it worked or not. i need this to be audited throughout the whole system"

### What the audit found

Counted mechanically across all 135 `.tsx` files by `scripts/audit-buttons.mjs`,
which is still runnable — it now doubles as a regression check and exits non-zero
if a raw `<button type="submit">` reappears inside a `<form action={…}>`:

| | count |
|---|---|
| `<button>` elements | 207 across 79 files |
| …submit buttons | 128 |
| …of those, inside a `<form action={…}>` server action | 113 across 53 files |
| …non-submit (`onClick`) buttons | 79 |
| **buttons with any `:active` / press styling** | **0** |
| `<form>` elements | 126 (111 server action, 10 `method="get"`) |

Zero press states app-wide is the whole complaint: nothing happened between the
click and the page changing, so a slow server action looked identical to a dead
button — and the natural response is to click it again.

### The three signals

1. **Press** — global `:active` in `globals.css`: `scale(0.94) translateY(1px)` +
   `brightness(0.82)`, plus a `:focus-visible` outline (keyboard users had
   nothing at all). Deliberately global rather than a utility class so it reaches
   every button — icon buttons in table rows, tabs, the theme toggle — not just
   the ones someone remembers to opt into.
2. **Working** — a spinner, `cursor: wait`, and a disabled button (which is also
   the double-submit guard).
3. **Done** — an emerald ring flashes when the action finishes, and only once the
   work has really landed.

### ⚠️ The first attempt was correct and still invisible

Everything above applied, and the buttons still read as dead. Measured against a
**production build** — dev-mode timings are not the ones anybody gets:

| what | measured |
|---|---|
| `Save account` pending state | **~128ms** — 8 frames out of 245 |
| `Archive` on a list row | **~16ms**, then the button left the DOM at frame 5 |
| `Create & build` | **78ms**, then unmounted (the action redirects) |
| completion flash on `/packages` | **never fired** — the button no longer exists |

Two separate causes, and neither is fixable by styling the button harder:

- **The work is faster than perception.** A correct spinner shown for an eighth
  of a second is a flicker. Hence `MIN_WORKING_MS` / `MIN_BUSY_MS` (550ms): the
  working state is *held* past the end of the work.
- **The button is destroyed before the work finishes.** `router.refresh()`
  replaces the row; a redirect replaces the page. Holding state on a component
  that is about to be unmounted cannot help.

So feedback also lives *above* the thing that re-renders:
`src/components/WorkIndicator.tsx` is a page-level bar mounted in `AppShell`,
driven by `beginWork()` from both `SubmitButton` and `useBusy`. Its minimum
on-screen deadline is a **module-level timestamp, not React state** — a redirect
remounts the component, and state would reset (measured: 99ms of bar, then the
new page wiped it). With the deadline outside React the bar spans the navigation.

### Three button families, not one

The original audit said the 79 `onClick` buttons were fine because they "already
had a `disabled` binding". That was the wrong test: it checked a pending binding
*existed*, not that it lasted long enough to see. `ListRowControls` — Archive and
tag-save, on **every list page** — is a client component doing `fetch` +
`router.refresh()`, and its `busy` flag was on screen for ~30ms.

- `<form action={…}>` submits → `SubmitButton` (`useFormStatus`)
- client `fetch` + `router.refresh()` → `useBusy` (`src/lib/useBusy.ts`)
- `method="get"` filter forms → browser navigation, press state only

Both families set the same `data-pending` attribute, and the spinner is a CSS
`::after` on it rather than an element, so there is one mechanism and nothing to
remember when adding a button.

### Verified in a real browser

`scripts/verify-button-feedback.mjs` (Playwright, throwaway database, run
against a **production build**). It tests perception, not internals — an earlier
version asserted "does the button carry `data-pending`" and passed while the
feature was invisible in practice. The central check samples the whole page every
animation frame and asks how many milliseconds ANY feedback was on screen:

- in-place save — **616ms** visible, flash fires, and the flash only appears once
  the row really exists, created exactly once
- list row action, where the button is removed by its own refresh — **614ms**
- redirecting save, where the whole page is replaced — **616ms**
- nothing stuck: no bar, no disabled button left behind
- one form with several submit buttons: only the pressed one spins

Caveat on method: holding the POST open with request interception showed
`pending` dropping before the response, which would make the flash premature. It
could not be reproduced without interception, and under real timings the flash
lands after the row exists — so it is recorded as a likely artifact of the
interception, not a verified property.

## Package pricing + PO status: the SQL that was missing (2026-08-18)

PRs #93–#98 (package cost/markup pricing, markup-vs-margin mode, promo→package,
and the Pending → Ordered → Received → Fulfilled purchase-order workflow) changed
`src/db/schema.ts` but shipped **no SQL**, so the live database never got:

- `purchase_order_status` enum values `ordered` and `fulfilled`
- `packages.package_price`, `.markup_pct`, `.pricing_mode`, `.source_promo_id`

The code on `main` reads and writes all of these, so those screens error against
the live database until the SQL runs. `docs/sql/promo_phase7.sql` covers it —
additive and nullable only, no backfill, safe to re-run.

Verified by building a database from the schema as it stood at the last SQL the
user ran (accounting_phase11), confirming `scripts/scratch-schema-drift.ts`
reported exactly those four columns as missing, applying the file, and
confirming the drift went to zero and the enum gained both values. Re-run twice
more with no errors.

**When a session changes `schema.ts`, it owes a SQL file in the same commit.**
That is the rule in this document's build-patterns section, and this is the
second time it has been missed (see the `part_receipts` gap above) — both found
only because something else went looking.

## Packages: composition, per-line discounts, currency (user requirements, 2026-08-18)

Six fixes to the packages / quotes / promos builders.

### Composing a package from a promo plus add-ons

> "I have a whelen regional piu promo + 2 additional ions I need to add to the
> build. That should be its own package."

`+ Add package / promo…` in the package builder pulls an existing package (a
vendor promo becomes one via **Add to Packages**) into the one being edited as
**flat, individually editable lines** — the user's explicit choice over a
collapsed group.

Everything is COPIED, nothing referenced:

- the source package is never written to, so re-syncing the promo later cannot
  disturb a build made from it, and editing a line here cannot disturb the promo
- each line's `cost` is locked from the source (the negotiated promo cost, not
  today's average cost)
- the source's bundle price is allocated across the copied lines as per-line
  discounts, so the parts still total the promo price instead of silently
  reverting to list
- lines carry `fromLabel` and show "from <promo name>" so the origin is visible

### Per-line discounts, composing with the bundle price

Packages already had a bundle price; quotes already had per-line discounts.
Packages now have both, and — per the user — **neither overrides the other**:
"the bundle promo price should stay with the option to discount on top of the
promo as well if needed."

Order: list price → bundle allocation → per-line discount. A percentage is taken
off the **bundle-allocated price**, so "10% off" on a promo line means 10% off
what the promo charges, not 10% off list. The two live in separate fields
(`bundleDiscount` vs `discount`) precisely so one cannot silently overwrite the
other — the allocation used to write `discount` directly, which wiped out any
discount the package carried.

### Currency

One module owns money: `src/lib/money.ts` (`round2`, `fmtUSD`, `parseMoney`,
`discountAmount`) with `src/components/MoneyInput.tsx` providing the field
primitives. Every currency figure carries a `$` and exactly two decimals, in
readouts AND input boxes; quantities and hours deliberately carry neither, which
is what the user was asking for ("It currently confuses with quantities").

**The audit found the same discount arithmetic hand-written in five places** —
the editor, the print view, the quote PDF, and the upfit PDF twice — each
slightly free to drift, and none of them aware of the bundle allocation. All now
call `lineGross` / `lineDiscount` / `lineNet`. `quoteTotals` re-exports `round2`
rather than defining a second one.

### Enter, and the add controls

- Enter in any builder field commits the value and opens the next line, instead
  of doing nothing (or submitting the whole form). Values also still commit as
  you type, so nothing is lost by clicking away either.
- The add controls sit at the **top and bottom** of the contents box in packages
  and promos (quotes already had both), and the contents list scrolls inside its
  own card so the totals and the bottom controls stay reachable on a long build.

### Internal cost

Package lines take the part's **`avg_cost`** — the weighted-average basis job
costing actually uses — rather than `parts.cost`, a 2dp mirror that only tracks
it when the receive path updates it and can be edited by hand. The part search
API returns both; `cost` remains the fallback.

### Verified

- `scripts/verify-package-money.ts` — pure math: both reductions apply, a
  percentage comes off the promo price, rows foot to the total at awkward bundle
  prices ($1, $99.99, $123.45), labor/fees stay out of a parts bundle, and a
  bundle above list is refused rather than inverted.
- `scripts/verify-package-builder.mjs` — Playwright against a **production**
  build: the Whelen scenario end to end (promo in, costs 840/195 locked, parts
  net exactly $1,700, 2 Ions added at avg cost 61.25 not 55.00), add controls at
  both ends, Enter adds a line without submitting, money formatted and
  quantities not, and the source promo byte-identical afterwards.

One caution worth recording: an earlier version of the quote check reported
"PASSED" while running **zero** assertions, because the seed had no quotes to
open. A check that cannot fail is not a check — assert that the fixture exists.

## Notes on building order

When extending a feature, re-read this file first. When adding a NEW
requirement during a build session, append it here in the same commit
so future sessions pick it up.
