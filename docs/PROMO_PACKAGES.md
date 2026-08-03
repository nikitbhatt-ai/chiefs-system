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

Answered by Nikit 2026-08-03:

1. **Costing method — weighted average is primary, FIFO secondary.**
   Overrides the brief's FIFO-only assumption. Average cost is the basis for
   cost accounting on all work orders; FIFO stays available as a second
   valuation. Design consequences in §0.8 below.
2. **Reservation trigger — when the work order enters `confirmed`.** The
   customer PO is received and the team moves the build into the confirmed
   workflow stage. See §0.9.
3. **Whelen rebates — none.** Whelen does not pay backend or growth
   incentives, so Phase 4 needs no rebate-to-cost mechanism. If another
   vendor ever does, it reopens as a new decision.
4. **Customer POs vs vendor POs** — already separate, see §0.5. No work.

6. **`parts.cost` vs average cost — stay distinct.** `parts.cost` becomes an
   auto-updated **last cost**; `avg_cost` is the separate weighted average.
   Both update **at receipt, not PO entry**. Average cost shows on an
   **internal-only** margin view, never on the customer PDF. Full mechanics
   and the last-cost/PO-pre-fill trap in §0.10.

Still open:

5. **PO lines: jsonb or a `purchase_order_line` table** — raised by the
   audit, see §0.4. Not needed until Phase 4; recommendation is to promote
   to a table. Proceeding on that assumption unless told otherwise.

---

## 0.8 Costing method: weighted average primary, FIFO secondary

### What stays the same

Cost layers are still the foundation, and Phase 2 still builds them. Layers
remain the subledger of record for **quantity and provenance** — which
receipt, which PO, which promo, at what actual cost — under both methods.
Average cost is derived *from* layers, not instead of them. Nothing about
Phases 1, 3, 4 changes.

### What changes

**A per-part moving average, maintained on receipt.** Add `parts.avg_cost`
as `numeric(12,4)` (4dp: the average is a derived rate, not a posted amount,
and 2dp would decay under repeated receipts — same reasoning as
`tax_rates.rate_pct`). Recomputed inside the existing receive transaction:

```
new_avg = (on_hand × old_avg + received_qty × receipt_unit_cost)
          / (on_hand + received_qty)
```

**Issue splits quantity from cost.** Issuing N units drains layers
oldest-first exactly as today — that preserves provenance and keeps on-hand
honest — but the cost charged to the job is `N × avg_cost` under weighted
average, or the summed layer cost under FIFO. This is a one-line lever:
`postInventoryIssue`'s `totalCents` is the only thing job costing reads, since
`src/lib/jobCosting.ts` takes a job's material cost from the WIP (1300) GL
balance tagged with `work_order_id`. Change what gets debited and every
work-order cost, WIP settlement, and COGS figure follows automatically.

**The active method is an auditable policy setting**, not a per-call flag —
a one-row `costing_policy` table `(method, changed_at, changed_by)`
defaulting to `weighted_average`. Switching methods is a change in accounting
policy: it applies forward only, never retroactively, and it must never
rewrite posted entries.

**Valuation and reconciliation follow the active method.**
`src/lib/inventoryValuation.ts` currently hard-codes the FIFO subledger
(`Σ remaining_qty × unit_cost`) and reconciles it to GL 1200. It becomes
method-aware: under weighted average the subledger is
`Σ on_hand × avg_cost`. The GL ties to whichever method is active; the other
is computed alongside as the comparison view — that is what "FIFO a second
option" buys us.

Worth knowing: **the two methods agree whenever a SKU fully turns over.** At
on-hand zero both valuations are zero. They differ only while stock is on the
shelf, and the difference is timing, never a permanent gap.

### The one thing to watch

Under weighted average a discounted package receipt pulls the average down
for *everyone* — the promo saving is smeared across all units of that SKU
rather than sitting visibly in one layer. That is the correct economics and
it is exactly why average costing is the right primary for work-order costing
here: a build's cost reflects what the shelf actually costs, not which crate
a bracket happened to come from.

But it means **Phase 7's promo-vs-backfill report cannot be built from job
costing** — the saving is invisible there by construction. It must key off
the layer table's `source_kind` and per-layer `unit_cost`, which retain the
package-vs-full-price distinction regardless of the active method. Phase 2
must therefore keep layers even though average costing alone wouldn't
strictly need them. Noted so a later session doesn't "simplify" them away.

Separately: `parts.cost` today is the internal/list cost that pre-fills PO
lines and drives the margin calculators on the part form. It is *not* the
same number as `avg_cost` and should stay distinct — one is what we expect to
pay, the other what we actually paid. Whether the margin display should
switch to `avg_cost` is a real question, but out of scope here.

## 0.10 Three cost fields, and what maintains each

Confirmed 2026-08-03: `parts.cost` and average cost stay **distinct fields**.
The result is the standard ERP triple:

| Field | Meaning | Maintained by |
| --- | --- | --- |
| `parts.cost` | **Last cost** — the most recent price actually paid | Auto, on receipt |
| `parts.avg_cost` `numeric(12,4)` | **Weighted average** — the accounting basis for work orders | Auto, on receipt |
| `parts.price` | Sell price | Manual |

**Both auto-fields update at receipt, never at PO entry.** Entering a PO
records the line's `unit_cost` and snapshots the promo allocation, but moves
nothing in costing. Only goods actually landing update cost — so a cancelled
or never-shipped PO can't leave a cost with nothing behind it. Both updates
happen inside the existing receive transaction alongside the layer write.

### Trap: last cost must not contaminate PO pre-fill

`POEditor.tsx:133` currently pre-fills a new PO line's `unitCost` from
`parts.cost`. Once `parts.cost` is last-cost-auto-updated, a package receipt
sets it to the **allocated** (discounted) cost — and the next *individual* PO
for that SKU would then pre-fill at a promo price Whelen will not honour. We'd
be raising POs at a price that doesn't exist.

Fix, and it's the reason Phase 1 comes first: **individual PO lines pre-fill
from `vendor_part_price.alacarte_unit_cost`, not from `parts.cost`.** Last
cost stays an honest record of what we paid (allocated cost included, because
that *is* what we paid); the price list is what we quote a new order at. Phase
4 must wire the pre-fill to the price list when it touches the PO editor.

### The margin calculators move on their own now

The part add/edit forms compute margin and markup from `cost` vs `price`, and
`cost` will now change under them without anyone editing it. Keep the field
editable — parts never yet received, and opening values, still need a way in —
but relabel it "Last cost (auto-updated on receipt)" so nobody mistakes a
moved number for someone's edit. Phase 2 does the relabel when it adds the
auto-update.

### Internal margin view on the invoice

Average cost displays on an **internal-only** view: the on-screen
quote/invoice page and an internal PDF variant, with per-line avg cost,
extended cost, margin $ and margin %, plus an invoice-level summary. The
customer-facing PDF is unchanged — `src/lib/pdf/templates/quote.tsx` carries
no cost data today and must keep carrying none, since these documents go to
government agencies.

One design point this raises: margin on an invoice should reflect cost **at
the time of sale**, not today's average. Per the brief's snapshot rule,
Phase 2 should stamp `avg_cost` onto the quote's line items when the quote
converts to an invoice, and the internal view reads that snapshot. Reading
`parts.avg_cost` live would make last quarter's margins silently rewrite
themselves every time we buy more stock.

## 0.9 Reservation trigger: the `confirmed` transition

Reservations fire when a work order enters `confirmed` — the point where the
customer's PO is in hand and the team commits the build to the shop.

Conveniently this is one event in the existing system, not two. For
government deals the Won bucket is `po_received`; for commercial and walk-in
it is `deposit_received`. Both run `maybePromoteWonDeal`
(`src/lib/dealTriggers.ts:35`), which inside a single transaction promotes the
quote to `workflowStage = 'confirmed'` and creates or updates the work order
to `status = 'confirmed'`. That transaction is the reservation hook.

Phase 5 will therefore add one `reserveForWorkOrder(tx, woId)` called from
every path that moves a WO into `confirmed` — `maybePromoteWonDeal`, plus
`syncWorkflowToDeal` for a card dragged into Confirmed directly on
`/workflow`. It must be idempotent (the existing promote path already guards
against double-firing via `already_past_confirmed`, but the board path needs
its own latch), and reservations release as parts are issued or when a build
is walked back out of `confirmed`.
