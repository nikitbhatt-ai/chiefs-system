# Promo packages, cost layers, reservations & backfill

Build brief accepted 2026-08-03. Seven phases, one at a time, approval
between each. This file is the running map + decision log for that work;
the requirement summary lives in `docs/REQUIREMENTS.md`.

---

## Phase 0 — Inventory audit (complete, no code changes)

### 0.1 Tables that already touch parts / inventory / vendors / POs / work orders

| Table | Purpose today | Relevance |
| --- | --- | --- |
| `parts` | The part master. `sku` is `unique not null` — the natural key the brief calls "SKU". Carries `quantity_on_hand`, `quantity_on_order`, `reorder_point`, `cost` (internal cost), `price` (sell), `vendor_id` (supplier), `manufacturer_id`, `lead_time_days`, `restricted`, `archived`. | **This is the one SKU / one bin table.** No promo/individual split exists — good, nothing to undo. |
| `part_receipts` | **Already a FIFO cost-layer table.** `(part_id, purchase_order_id, vendor_id, quantity_received, quantity_remaining, unit_cost numeric(12,2), received_at)`. Indexed on `part_id` and `received_at`. | This *is* the brief's `inventory_cost_layer`. Phase 2 should extend it, not create a parallel table. |
| `part_cost_history` | Append-only `(part_id, cost, recorded_at, source)`, written on every receipt with `source = po_number`. | Audit trail of cost movement; not a layer. |
| `purchase_orders` | Vendor-side PO. `(po_number unique, vendor_id, status, total numeric(12,2), expected_at, received_at, line_items jsonb, notes)`. | **There is no `purchase_order_line` table.** Lines are a jsonb array. See 0.4. |
| `packages` | Sales-side kits ("canned services"). `components jsonb` of item / labor / fee, itemized roll-up pricing onto a quote. | **Not** a vendor promo. This is what we *sell*, `vendor_promo` is what we *buy*. Keep them separate. |
| `vendors` | `(name, contact_name, email, phone, address, notes, discount_pct numeric(5,2))`. Doubles as manufacturer list. | `vendor_id` target for the price list and promos. Note `discount_pct` is a blunt vendor-wide field, unused by costing. |
| `work_orders` | `(wo_number, customer_id, vehicle_id, quote_id, deal_id, status, parts_consumed bool, target_build_start_date, safety_buffer_days, cogs_journal_entry_id, …)`. | Reservation owner (Phase 5) and issue target (Phase 2). `parts_consumed` is the current all-or-nothing consumption latch. |
| `quotes` | `line_items jsonb` of `{description, quantity, unitPrice, total, partId?}`. | The de-facto bill of materials for a work order — consumption and procurement both roll up from here, not from a WO parts table. |
| `bills` / `bill_lines` / `payments` | AP module, integer cents. `bills.purchase_order_id` already links a bill to a PO. | Where a real vendor liability lands. Receiving currently bypasses it (0.6). |
| `journal_entries` / `journal_lines` | GL, `status ∈ draft/posted/void`, integer cents. | Posted entries are immutable — brief's "don't touch posted entries" rule already holds here. |

Not present, must be built: `vendor_part_price`, `vendor_promo`,
`vendor_promo_line`, `inventory_issue`, `inventory_reservation`,
`reorder_point` (as a table), `stock_override_log`,
`backfill_requisition`.

### 0.2 Money columns and their SQL types

Two conventions coexist, both exact — **no `real`, `float`, or `double precision`
anywhere in the schema.**

**Operational side — `numeric(12,2)`:**
`vehicles.purchase_price`, `vehicles.list_price`, `quotes.subtotal`,
`quotes.tax_total`, `quotes.grand_total`, `parts.cost`, `parts.price`,
`part_receipts.unit_cost`, `part_cost_history.cost`, `purchase_orders.total`.
Plus non-money `numeric`: `vendors.discount_pct (5,2)`,
`tax_rates.rate_pct (6,3)`, timeclock lat/lng.

**Accounting side — `bigint` integer cents:**
`journal_lines.debit_cents` / `credit_cents`, `ar_invoices.*_cents`,
`receipts.amount_cents`, `bills.total_cents`, `bill_lines.amount_cents`,
`payments.amount_cents`, `labor_rates.rate_cents`.
Bridged by `dollarsToCents()` in `src/lib/accounting.ts`.

**The one real exposure: money inside `jsonb`.** `purchase_orders.line_items`
and `quotes.line_items` store `unitCost` / `unitPrice` / `total` as JSON
numbers, i.e. IEEE-754 doubles round-tripped through
`JSON.parse`/`stringify`. They are read back with `Number(...)` and
multiplied by quantity in several places
(`src/app/purchase-orders/[id]/page.tsx:20`,
`POEditor.tsx:37`, `src/lib/inventory.ts:223`). Values are small and
2-decimal so nothing has drifted yet, but this is the floating-point money
the brief warns about, and the allocation engine must not inherit it.
→ **Recommendation for Phase 4:** promote PO lines to a real
`purchase_order_line` table with `numeric(12,2)` columns rather than adding
`source_promo_id` / `alacarte_cost_snap` as more jsonb fields. Details in 0.4.

### 0.3 On-hand: stored *and* computed — they can drift

Both exist:
- **Stored:** `parts.quantity_on_hand integer`. Incremented on receipt,
  decremented on consumption (`src/lib/inventory.ts`), and directly editable
  on the part form and via CSV import.
- **Computed:** `Σ part_receipts.quantity_remaining`. Used by
  `src/lib/inventoryValuation.ts` as the inventory subledger, and displayed
  per-part on `/inventory/[id]` as a FIFO layer table with a cost preview.

They are **not** reconciled to each other. Two known drift sources:
1. `consumeWorkOrderParts` floors on-hand at zero
   (`GREATEST(0, qty_on_hand - qty)`) and separately records a `shortages[]`
   when the layers can't cover the draw — so a short build leaves stored
   on-hand and layer sum disagreeing by the shortfall.
2. Any part created or imported with an opening `quantity_on_hand` has no
   layers at all — on-hand > 0 with zero layer coverage. Since the à la carte
   CSV import is the documented way inventory was loaded, this is likely
   true for most of the catalog today.

`inventoryValuation.ts` reconciles the **layer sum ↔ GL account 1200** and can
post the difference to equity, but nothing reconciles **stored on-hand ↔ layer
sum**. Phase 2 has to pick one as authoritative (the brief says derive from
layers) and add an opening-balance backfill for layerless stock.

`parts.quantity_on_order` is never maintained by code — it is only set by the
part form and CSV import. Receiving does not decrement it. Treat it as
untrusted for Phase 6.

### 0.4 How a PO line records unit cost, and what receiving already does

**PO lines are jsonb, not rows.** `purchase_orders.line_items` is
`POLineItem[] = { partId?, description, quantity, quantityReceived, unitCost }`
(`src/db/schema.ts:338`). The editor (`POEditor.tsx`) pre-fills `unitCost` from
`parts.cost` when a part is picked from the autocomplete, and the operator can
override it. `purchase_orders.total` is recomputed as `Σ qty × unitCost` on save.

**Receiving already exists and is good.** `receivePurchaseOrder(poId, Map<lineIndex, qty>)`
in `src/lib/inventory.ts:197`:
- One `db.transaction`, locks the `purchase_orders` row `FOR UPDATE` and
  re-reads `line_items` inside the transaction.
- Clamps each receipt to the line's outstanding quantity.
- Per received line: inserts a `part_receipts` layer at the line's `unitCost`,
  bumps `parts.quantity_on_hand`, writes a `part_cost_history` row.
- Rolls the PO status to `partially_received` / `received`.
- Calls `postInventoryReceipt` → Dr 1200 Inventory / Cr 2000 AP.

Consumption and reversal also exist: `consumeWorkOrderParts` drains layers
oldest-first (`ORDER BY received_at ASC … FOR UPDATE`), charges WIP at real
drained FIFO cost, and latches on `work_orders.parts_consumed`;
`restoreWorkOrderParts` refills the same layers and reverses the entry.

**Gaps against the brief:**
- *Idempotency is lock-based, not key-based.* Two concurrent receives
  serialize correctly, but there is no unique constraint or receipt key on
  `part_receipts`. A retried request after a committed transaction, or a
  replayed server action, can create a second layer. The brief asks for a
  constraint — add a `receipt_key` unique index in Phase 4.
- *No per-issue record.* Consumption decrements layers but writes no
  `inventory_issue` rows, so there is no line-level record of which layer fed
  which build at what cost — only the rolled-up WIP journal entry. Phase 2
  must add it.
- *Consumption is whole-work-order, all-or-nothing.* Driven off the linked
  quote's line items and latched by one boolean. There is no partial issue,
  no issue of an arbitrary quantity, and no walk-in / non-WO pull path. Phase 2
  and Phase 5 both need a general `issue(sku, qty, workOrderId?)`.
- *Receiving credits AP directly, no bill.* `postInventoryReceipt` posts
  Dr Inventory / Cr AP without creating a `bills` row, even though
  `bills.purchase_order_id` exists for exactly that link. Nothing three-way
  matches receipt → bill → payment. Flagging it; out of scope unless asked.
- *No line index stability.* `receiveByIndex` keys on array position, so
  editing a PO's lines between receipts can misapply a receipt. Another point
  for promoting lines to rows.

### 0.5 Vendor PO vs customer PO — already separate, no collision

`purchase_orders` is unambiguously vendor-side: `vendor_id` FK, receiving,
AP posting, no customer or deal link. A government customer's PO *to us* is
not an entity at all — it is represented as the `po_received` **deal stage**
plus an uploaded document
(`kind = pipeline_doc:government_po_intake`, category `purchase_orders`) in
`customer_documents`. Confusingly the `purchase_order_status` enum also has a
`po_received` value, but it is a vendor-PO status and unrelated. **Decision 4
is already satisfied** — no work needed, and the promo work must not add a
customer-PO meaning to this table.

### 0.6 Conventions the new code must follow

- Server components for list/detail, server actions for mutations,
  `AppShell` chrome, `FormField` captions on every form field.
- `import { db } from "@/db"`, tables from `@/db/schema`.
- API route pairs `/api/{section}/route.ts` + `/api/{section}/[id]/route.ts`,
  each re-checking `auth()` and returning 401.
- Schema changes ship as hand-run SQL in `docs/sql/` — never `drizzle-kit push`.
  Existing files are named `accounting_phaseN.sql`; these will be
  `promo_phaseN.sql`.
- Accounting hooks are **non-fatal**: if the chart of accounts isn't seeded,
  resolve-all-then-bail rather than throw. New postings must match that.

### 0.7 Net assessment

The costing spine the brief asks for in Phase 2 is roughly 70% built —
`part_receipts` is a working FIFO layer table with transactional,
lock-protected receive and consume. Phase 2 becomes *extend and generalize*
(add `source_kind` / `promo_id` / issue rows / a general issue function /
opening-balance layers) rather than *build from scratch*. Phases 1, 3, 5, 6, 7
are all new ground. The riskiest structural decision is Phase 4's:
whether to keep PO lines as jsonb or promote them to a table.

---

## Decision log

Pending answers from Nikit before Phase 1:

1. **Costing method** — FIFO (brief's assumption). Matches what's already
   built in `part_receipts`.
2. **Reservation trigger** — on work-order creation for a won, fixed-price
   build (brief's assumption), not at quote stage.
3. **Whelen rebates** — if paid after the fact, reduce part cost rather than
   book as other income. Changes Phase 4.
4. **Customer POs vs vendor POs** — confirmed already separate, see 0.5.
5. **PO lines: jsonb or table** — new question raised by the audit, see 0.4.
