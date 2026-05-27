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
- [ ] **CSV/Excel mass import** where useful (parts inventory at minimum).

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
- [x] Status workflow: draft → sent → approved → converted.
- [x] Customer dropdown.
- [x] Tax rate input per quote.
- [x] Add parts from inventory to a quote via "+ Add from inventory…"
      dropdown. Adds line with sku/name/price/partId; stock NOT deducted
      at quote time (deducted when the linked work order moves to
      "In Progress" on the Workflow board).
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
- [x] Manufacturer + Supplier dropdowns sourced from Vendors.
- [x] Filters on category, vendor, archived.
- [x] Edit pencil opens correct row (uses `/inventory/[id]/edit` pattern).
- [ ] Mass import via CSV/Excel.
- [ ] Per-part PO history button — currently shown as the FIFO layers
      table on /inventory/[id]; consider a dedicated button if needed.
- [ ] Inline "Add new vendor" inside the dropdown (currently links
      out to /vendors).

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
      board. Idempotent via `work_orders.parts_consumed`.
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

## Upfit Builder (not yet built)

- [ ] Lives inside the CRM as a tab on a deal AND as a standalone tool.
- [ ] Upfit configs save to the customer entity for historical record.
- [ ] CAD design attachable to the upfit config.
- [ ] Build packages upload-able to both CRM and inventory parts list.

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

Standalone, dependency-free Node.js ES-module (not part of the Next.js
app) that creates Shopify car listings from a VIN.

- `createCarListing(input)` pipeline:
  validate VIN → decode via NHTSA vPIC → build product → create in Shopify.
- Input: `vin`, `price`, optional `condition`, `mileage`, `photoUrls`,
  `notes`, `productType` (default "Used Vehicle"), `status` (default "draft").
- VIN validation: 17 chars, no I/O/Q. NHTSA `ErrorCode` must be "0"/"0,…".
- Shopify Admin REST `2024-10`; credentials from `SHOPIFY_STORE_DOMAIN`
  and `SHOPIFY_ADMIN_TOKEN` env vars (never hardcoded).
- Variant: SKU = VIN, inventory_management "shopify", quantity 1,
  requires_shipping true, weight 0.
- Returns `{ status, productId, adminUrl, storefrontUrl, title, decoded }`
  or `{ status: "error", stage, error }`.
- Deferred (noted in module README): update-by-SKU, local photo uploads,
  explicit InventoryLevels per location, `orders/create` sold-car webhook,
  GraphQL Admin API migration.

## Notes on building order

When extending a feature, re-read this file first. When adding a NEW
requirement during a build session, append it here in the same commit
so future sessions pick it up.
