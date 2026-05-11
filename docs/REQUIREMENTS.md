# Feature Requirements

This is the running spec of what each module needs. Consult this document
whenever building or extending a feature. Items marked ✅ are done; others
are pending and should be addressed when their owning module is built.

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
- [ ] **Server-side PDF generation** (e.g. @react-pdf/renderer) for
      pixel-consistent output instead of relying on browser print.
- [ ] **Send-to-customer** is separate from Print — takes an email input
      and emails the PDF for approval.
- [ ] **CSV/Excel mass import** where useful (parts inventory at minimum).

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
- [x] **Per-pipeline document templates** (PR 4): three docs defined in
      `src/lib/documentTemplates.ts` — Government PO Intake, Walk-In
      Credential Intake, Commercial Deposit Receipt. Each has a
      generate (print-friendly HTML at
      `/deals/[id]/documents/[kind]/print`) and upload action on the
      deal page's Documents panel. Uploaded copies go to Vercel Blob
      and a `files` row with `kind = pipeline_doc:<slug>`. Stage gate:
      `canAdvanceTo` rejects advancement to/past
      `pipelineDocumentRequiredBeforeStage` unless a matching `files`
      row exists. Generic "other attachments" upload also available.

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

## Notes on building order

When extending a feature, re-read this file first. When adding a NEW
requirement during a build session, append it here in the same commit
so future sessions pick it up.
