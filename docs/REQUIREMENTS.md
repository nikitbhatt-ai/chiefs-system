# Feature Requirements

This is the running spec of what each module needs. Consult this document
whenever building or extending a feature. Items marked ✅ are done; others
are pending and should be addressed when their owning module is built.

## Cross-cutting requirements (apply to every module)

- [ ] **Edit anywhere**: every entity must have an Edit page (`/{section}/[id]/edit`).
      ✅ done for: customers, vendors, leads.
- [ ] **Filter by column** on every list view (customers, leads, work orders,
      inventory, purchase orders, quotes, vehicles). Common filters: customer,
      brand/manufacturer, most recent date, status, tags.
- [ ] **Tags + archive + delete** on every list.
- [ ] **Branded PDF export** (logo, Times New Roman 12pt) — for quotes,
      estimates, upfit configs, work orders, inventory exports, invoices,
      CRM lists.
- [ ] **Print and Send-to-customer are separate buttons.** Send takes an
      email input and sends for approval; Print just opens the PDF.
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

## Deals (not yet built)

- [ ] Pipeline / kanban view with drag-and-drop between stages.
- [ ] Tags on each deal.
- [ ] Referral source field: options = Sames, Website, Sales person,
      manually-added name/source.
- [ ] Internal notes section.
- [ ] Quote builder lives inside the deal.
- [ ] Upfit builder lives inside the deal.

## Quotes / Estimates / Invoices (not yet built)

- [ ] Add parts to a quote when clicking into it (was broken in old build).
- [ ] **Line items** with these per-row controls:
  - Discount % OR $ amount toggle.
  - Discount % uses a built-in calculator that recomputes Price in real time
    based on the customer.
  - Discount total computed at the bottom of the invoice.
- [ ] Custom fees + fixed fees, with the ability to remove fixed fees per quote.
- [ ] Partial payment tracking, down-payment tracking.
- [ ] CAD design upload (sent during quote/closing) — uses Vercel Blob.
- [ ] PDF export for quotes/estimates/invoices (branded, see cross-cutting).
- [ ] Print and Send-to-customer are separate (see cross-cutting).
- [ ] Internal notes per quote.

## Vehicles

- [x] **Multi-lot support**: on-site, dealership, upfitting, Sames drop-off.
      Implemented as `lotLocation` dropdown on the vehicle form.
- [x] VIN decoder via NHTSA vPIC API at `/api/vin/decode/[vin]`. Form
      auto-fills year/make/model/trim. "Save vehicle" creates the asset.
- [x] List, add, edit, delete.
- [ ] VIN history of all work completed on the vehicle (depends on
      Work Orders module).

## Inventory / Parts (not yet built)

- [ ] Mass import via CSV/Excel.
- [ ] Pricing per part:
  - Rename "Cost Price" → **"Internal Cost"** everywhere (parts UI,
    invoices, estimates).
  - Rename "Retail Price" → **"Price"** everywhere.
  - Remove Government Price + Commercial Price (use one Price).
  - Per-part margin and markup % selectors so MSRP can be set per
    vendor's margins.
- [ ] Manufacturer + Supplier fields are dropdowns sourced from the
      Vendors table; dropdown has an inline "Add new vendor" option.
- [ ] Per-part PO history button → shows avg cost + FIFO costing.
- [ ] Pencil/edit icon must edit the correct row (was buggy in old build —
      we will avoid this by using `/inventory/[id]/edit` pattern).
- [ ] Filters on every column.

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

## Purchase Orders (not yet built)

- [ ] List + filters.
- [ ] PO history per part (powers the Inventory PO history button).

## Time Clock (not yet built)

- [ ] Clock in/out, active timers.
- [ ] **Geofencing** — only allow clock-in within a configured radius of
      the shop. Browser geolocation + radius check.
- [ ] **Build-time-per-part agent tracker**: when a part is added to a
      work order, automatically log time toward the build. (Need to
      clarify what "agent" means — likely the assigned technician.
      Confirm with user when building.)

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

These need answers before the related feature can be built:

1. **"Agent tracker for build time per part"** — does "agent" mean the
   assigned technician (employee), or an AI agent? If technician: when a
   part is added to a work order, do we auto-log time, or start a timer
   for the technician?
2. **Logo file** for branded PDFs — needs to be uploaded to `public/`
   when we get to PDF export.
3. **Email sending** — which provider? Resend / SendGrid / M365 SMTP?
   `.env.example` already has SMTP placeholders.
4. **Time-clock geofence** — what's the shop address (lat/lng) and
   radius (meters)?
5. **Accounting reports** — who receives the weekly/monthly emails?
   What's in them?
6. **Workflow page**: kanban will live inside Work Orders and Deals
   (per backlog). User to confirm whether a separate top-level
   "Workflow" page is needed in addition.

## Notes on building order

When extending a feature, re-read this file first. When adding a NEW
requirement during a build session, append it here in the same commit
so future sessions pick it up.
