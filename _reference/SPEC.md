# Chiefs Pursuit Surplus — Recovered Spec

This document catalogs what was recovered from deobfuscating the original
Vite/React build (`old-build/index-bhiHYhO9.js`). The deobfuscated source lives
at `_reference/deobfuscated.js`. Use this spec + the deobfuscated source as the
authoritative reference while transcribing screens into the new Next.js app.

The variable names in `deobfuscated.js` are mangled (`_Component58`, `Oi`, `be`,
etc.) but **JSX, Tailwind classes, field names, API URLs, and constant maps are
intact**. Treat the file as readable source — just rename as you transcribe.

## 1. Business model

Internal-only ERP/CRM for **Chiefs Pursuit Surplus**: a dealer that buys used
police pursuit vehicles, refurbishes / upfits them, and resells.

Workflow modules:

- Sales cycle CRM (leads → customers → deals → quotes → POs)
- Dealer lot / vehicle inventory management
- Upfitting workflow (work orders, QC checklists, parts)
- Parts inventory (with bulk import + on-order tracking)
- Time clocks per job/work-order
- Accounting + reporting
- File storage in customer/agency folders (invoices, build specs)
- Per-department AI agent stack (deferred — last phase)

## 2. Users & auth

All users are internal employees. **No customer-facing access.**

Two auth tracks:

1. **Microsoft Entra ID SSO** for `@chiefspursuitsurplus.com` Microsoft 365
   accounts (via the GoDaddy-fronted M365 tenant).
2. **Email magic-link** for employees who use personal email (Gmail, etc.)
   instead of company email.

Either path resolves to a user row. Access is gated by **role**, not by email
domain. Unknown emails are rejected (admin must invite first).

### Roles (recovered from bundle)

- `admin`
- `sales`
- `warehouse`

Likely needed (extrapolated from feature set, confirm with stakeholders):

- `tech` / `upfitter` (for work orders + QC)
- `accountant` (for accounting module)
- `manager` (mid-tier between admin and individual contributors)

## 3. Routes / screens

Top-level routes recovered from the wouter/react-router config:

| Path | Purpose |
| --- | --- |
| `/` | Dashboard (stats from `/api/dashboard/stats`) |
| `/crm` | Customers + Deals (tabbed view, pipeline cards) |
| `/leads` | Leads (with convert-to-deal action) |
| `/quotes` | Quotes (with convert-to-work-order action) |
| `/vehicles` | Dealer lot / vehicle inventory |
| `/vin-decoder` | VIN lookup tool (history + decode) |
| `/inventory` | Parts inventory (with bulk-import) |
| `/purchase-orders` | POs (with receive workflow) |
| `/work-orders` | Upfitting work orders |
| `/timeclock` | Per-employee clock in/out by job |
| `/reporting` | Reporting (incl. vehicle-units report) |
| `/cad-builder` | CAD/build-spec builder (TBD purpose — inspect bundle) |
| `/agents` | AI agent logs / management |

Each route likely has nested detail/edit views (modals or sub-routes).

## 4. API surface (24 endpoints)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login` | Replace with Auth.js routes |
| GET | `/api/dashboard/stats` | Aggregate counters for `/` |
| GET/POST | `/api/customers` | List + create |
| GET/POST/PATCH | `/api/deals`, `/api/deals/:id` | CRUD |
| POST | `/api/deals/:id/comms` | Log communication |
| DELETE | `/api/deals/comms/:id` | Delete comm entry |
| GET/POST | `/api/leads` | |
| PATCH/DELETE | `/api/leads/:id` | |
| POST | `/api/leads/:id/convert` | Convert lead → deal/customer |
| GET/POST/PATCH | `/api/quotes`, `/api/quotes/:id` | |
| POST | `/api/quotes/:id/convert-to-wo` | Quote → work order |
| GET/POST/PATCH | `/api/vehicles`, `/api/vehicles/:id` | |
| GET | `/api/vin/:vin/history` | VIN lookup history |
| GET | `/api/vin/decode/:vin` | NHTSA-style decode |
| GET/POST/PATCH | `/api/parts`, `/api/parts/:id` | |
| POST | `/api/parts/bulk-import` | CSV/XLSX upload |
| GET | `/api/parts/on-order-status` | |
| POST | `/api/parts/:id/archive` / `/restore` | |
| GET | `/api/parts/:id/cost-history` | |
| GET/POST/PATCH | `/api/purchase-orders`, `/api/purchase-orders/:id` | |
| POST | `/api/purchase-orders/:id/receive` | Mark received |
| GET/POST/PATCH | `/api/work-orders`, `/api/work-orders/:id` | |
| GET/POST/PATCH | `/api/qc-checklists`, `/api/qc-checklists/:id` | |
| GET | `/api/vendors` | |
| GET/POST | `/api/users` | |
| GET/POST | `/api/notes`, `/api/notes/:entityType/:entityId` | Polymorphic notes |
| DELETE | `/api/notes/:id` | |
| GET | `/api/time-entries`, `/api/time-entries/active` | |
| POST | `/api/time-entries/:id/clock-out` | |
| GET | `/api/accounting/summary`, `/api/accounting/generate-report` | |
| GET | `/api/reporting`, `/api/reporting/vehicle-units` | |
| GET/POST | `/api/templates` | |
| GET | `/api/agent-logs`, `/api/agent-logs/:id` | AI agent run logs |

In Next.js these become `app/api/.../route.ts` server routes. Keep the same
URL shapes so the recovered components work with minimal rewrites.

## 5. Recovered enums / constants

### Deal stages (`Oi` in source)

```
prospect      → Prospect       (zinc)
quote_sent    → Quote Sent     (blue)
po_received   → PO Received    (amber)
in_production → In Production  (violet)
delivered     → Delivered      (emerald)
lost          → Lost           (red)
```

### Customer types (`z3`)

```
government  (blue)
commercial  (amber)
retail      (zinc)
```

### Communication types (`E0`)

```
call        Phone Call    📞
email       Email         📧
in_person   In Person     🤝
note        Internal Note 📝
```

Stored in deal `comms` (and likely customer comms). Tracks `agentName` (logger),
`lastContactDate`, `type`, `message`.

### Quote / PO statuses (recovered from conditionals)

- Quote: `draft`, `sent`, `approved`, `converted`
- Purchase Order: `pending`, `partially_received`, `received`,
  `pending_review`, `po_received`
- Lead: `new`, `contacted`, `converted`
- Generic op state: `idle`, `pending`, `success`, `error`

### Vehicle statuses

`new`, `received`, `ready_for_pickup`, `delivered`, `sold`

## 6. Data model (initial draft)

Field names are recovered from the JSX (input names, prop accesses). Drizzle
schema in `src/db/schema.ts` should hew to these names so the transcribed
components don't need rewrites.

### `users`

- `id` (uuid pk)
- `username` (used as React key — keep unique)
- `displayName`
- `email` (unique)
- `role` (enum: admin / sales / warehouse / tech / accountant / manager)
- `microsoftEntraSub` (nullable — populated when SSO links)
- `createdAt`, `updatedAt`

### `customers`

- `id`, `name`, `type` (government/commercial/retail), `address`, `email`,
  `phone`, `taxExempt` (bool), `createdAt`, `updatedAt`

### `deals`

- `id`, `customerId` (fk), `assignedTo` (fk users), `salesRep`,
  `vehicleYear`, `vehicleMake`, `vehicleModel`, `vin`,
  `stage` (enum above), `createdAt`, `updatedAt`

### `deal_comms`

- `id`, `dealId` (fk), `agentName`, `type` (call/email/in_person/note),
  `lastContactDate`, `message`, `createdAt`

### `leads`

- TBD — inspect `/leads` screen in `deobfuscated.js`. Has `convert`
  endpoint that produces a customer + deal.

### `vehicles`

- `id`, `vin`, `year`, `make`, `model`, `status` (enum above), photos,
  pricing, lot location — confirm against `/vehicles` screen.

### `parts`

- `id`, `sku`, `name`, `quantityOnHand`, `cost`, `vendorId`, `archived`,
  cost history (separate table).

### `purchase_orders`, `work_orders`, `qc_checklists`, `quotes`,
### `vendors`, `time_entries`, `notes`, `templates`, `agent_logs`

Defer detailed field extraction until we transcribe each screen.

### `notes` (polymorphic)

- `id`, `entityType` (e.g. `deal`, `customer`, `work_order`), `entityId`,
  `body`, `authorId`, `createdAt`

## 7. Design system

Dark theme with amber accent. Core tokens (extracted from JSX):

- Background: `#0e0e1a` (page) / `#161624` (cards) / `#1a1a2e` (highlight)
- Borders: `white/5` and `white/10`
- Primary accent: `amber-500` (`#f59e0b`) — buttons, focus, highlights
- Text: `white` (primary), `zinc-300/400/500/600` (secondary scale)
- Badges: `bg-{color}-500/15 text-{color}-400` pattern
- Fonts: `Syne` (display) + `DM Sans` (body) via Google Fonts
- Test IDs: every interactive element has a `data-testid` — preserve these
  during transcription so future tests can match the original.

## 8. File storage

NEW requirement (not in original bundle): per-customer / per-agency folders
holding invoices and build specs. Plan: **Vercel Blob** with a path convention
like `customers/{customerId}/...` and a metadata table tracking uploads
(`files` table: id, entityType, entityId, blobUrl, filename, mime, sizeBytes,
uploadedBy, uploadedAt).

## 9. AI agent stack (deferred)

Per-department agents (sales, warehouse, accounting, etc.). The `/agents`
screen and `/api/agent-logs` already exist as the surface area. Hold off on
implementation until the core CRUD app is live and employees are using it.
Build the agent interface against the same Drizzle data, with a clear
`(prompt, context) → (action, log)` contract per department.
