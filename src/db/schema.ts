import {
  pgTable,
  text,
  uuid,
  timestamp,
  date,
  boolean,
  integer,
  bigint,
  numeric,
  jsonb,
  pgEnum,
  primaryKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["admin","manager","sales","warehouse","tech","accountant"]);
export const customerType = pgEnum("customer_type", ["government","commercial","retail","walk_in_credentialed"]);
export const dealStage = pgEnum("deal_stage", ["prospect","quote_sent","po_received","in_production","delivered","lost","credential_verification","deposit_received"]);
export const leadStatus = pgEnum("lead_status", ["new","contacted","converted","lost"]);
export const quoteStatus = pgEnum("quote_status", ["draft","sent","approved","converted"]);
export const purchaseOrderStatus = pgEnum("purchase_order_status", ["pending","pending_review","po_received","partially_received","received"]);
export const vehicleStatus = pgEnum("vehicle_status", ["new","received","ready_for_pickup","delivered","sold"]);
export const commType = pgEnum("comm_type", ["call","email","in_person","note"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  name: text("name"),
  image: text("image"),
  username: text("username").unique(),
  displayName: text("display_name"),
  passwordHash: text("password_hash"),
  role: userRole("role").notNull().default("sales"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  archived: boolean("archived").notNull().default(false),
  tags: text("tags").array(),
  name: text("name").notNull(),
  type: customerType("type").notNull().default("commercial"),
  address: text("address"),
  email: text("email"),
  phone: text("phone"),
  taxExempt: boolean("tax_exempt").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const vehicles = pgTable("vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),
  vin: text("vin").unique(),
  year: integer("year"),
  make: text("make"),
  model: text("model"),
  trim: text("trim"),
  color: text("color"),
  mileage: integer("mileage"),
  status: vehicleStatus("status").notNull().default("new"),
  lotLocation: text("lot_location"),
  purchasePrice: numeric("purchase_price", { precision: 12, scale: 2 }),
  listPrice: numeric("list_price", { precision: 12, scale: 2 }),
  condition: text("condition"),
  photos: jsonb("photos").$type<string[]>().default([]),
  description: text("description"),
  notes: text("notes"),
  shopifyProductId: text("shopify_product_id").unique(),
  shopifyStatus: text("shopify_status"),
  shopifyPublishedAt: timestamp("shopify_published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("vehicles_status_idx").on(t.status)]);

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  archived: boolean("archived").notNull().default(false),
  tags: text("tags").array(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source"),
  status: leadStatus("status").notNull().default("new"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  notes: text("notes"),
  customerType: text("customer_type"),
  subSource: text("sub_source"),
  subSourceMeta: jsonb("sub_source_meta"),
  partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
  partnerContactId: uuid("partner_contact_id").references(() => partnerContacts.id, { onDelete: "set null" }),
  convertedCustomerId: uuid("converted_customer_id").references(() => customers.id),
  convertedDealId: uuid("converted_deal_id").references((): AnyPgColumn => deals.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const deals = pgTable("deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  archived: boolean("archived").notNull().default(false),
  tags: text("tags").array(),
  customerId: uuid("customer_id").references(() => customers.id),
  assignedTo: uuid("assigned_to").references(() => users.id),
  salesRep: text("sales_rep"),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  vehicleYear: integer("vehicle_year"),
  vehicleMake: text("vehicle_make"),
  vehicleModel: text("vehicle_model"),
  vin: text("vin"),
  stage: dealStage("stage").notNull().default("prospect"),
  subStatus: text("sub_status"),
  currentStageEnteredAt: timestamp("current_stage_entered_at").notNull().defaultNow(),
  referralSource: text("referral_source"),
  notes: text("notes"),
  pipeline: text("pipeline"),
  source: text("source"),
  subSource: text("sub_source"),
  subSourceMeta: jsonb("sub_source_meta"),
  partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
  partnerContactId: uuid("partner_contact_id").references(() => partnerContacts.id, { onDelete: "set null" }),
  sourceLocked: boolean("source_locked").notNull().default(false),
  department: text("department"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("deals_stage_idx").on(t.stage),
  index("deals_customer_idx").on(t.customerId),
  index("deals_pipeline_idx").on(t.pipeline),
]);

export const pipelineStageSla = pgTable("pipeline_stage_sla", {
  id: uuid("id").defaultRandom().primaryKey(),
  pipelineSlug: text("pipeline_slug").notNull(),
  stage: text("stage").notNull(),
  warningDays: integer("warning_days").notNull().default(3),
  overdueDays: integer("overdue_days").notNull().default(7),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("pipeline_stage_sla_lookup_idx").on(t.pipelineSlug, t.stage),
]);

// CRM (deal) stage -> Workflow (work order) stage mapping. Editable by
// admins via /settings/stage-mapping. A row whose workflow_stage is NULL
// means the deal stage is pre-shop and does not appear on the workflow
// board. `archived` is a sentinel for lost / closed deals that should be
// hidden from the active workflow Kanban but kept for audit.
export const stageMapping = pgTable("stage_mapping", {
  crmStage: text("crm_stage").primaryKey(),
  workflowStage: text("workflow_stage"),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Audit log for stage transitions that bypassed the default guardrails.
// Two kinds: "skip_override" (forward jump of more than one stage allowed
// by a manager) and "backwards" (deal moved earlier in the pipeline).
// Backwards moves are allowed but always logged with a reason so we can
// trace why sales walked a deal back.
export const stageOverrides = pgTable("stage_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  fromStage: text("from_stage").notNull(),
  toStage: text("to_stage").notNull(),
  reason: text("reason").notNull(),
  userId: uuid("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("stage_overrides_deal_idx").on(t.dealId)]);

export const quotes = pgTable("quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  archived: boolean("archived").notNull().default(false),
  tags: text("tags").array(),
  quoteNumber: text("quote_number").unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  dealId: uuid("deal_id").references(() => deals.id),
  status: quoteStatus("status").notNull().default("draft"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).default("0"),
  taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).default("0"),
  grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).default("0"),
  lineItems: jsonb("line_items").$type<QuoteLineItem[]>().default([]),
  workflowStage: text("workflow_stage").notNull().default("estimate"),
  notes: text("notes"),
  // Vehicle this quote/invoice is for. Decoded from a VIN in the quote
  // editor (NHTSA vPIC) so the exact car being worked on ties to the
  // quote — and, on conversion, the invoice (same row).
  vin: text("vin"),
  vehicleYear: integer("vehicle_year"),
  vehicleMake: text("vehicle_make"),
  vehicleModel: text("vehicle_model"),
  vehicleTrim: text("vehicle_trim"),
  // Customer/agency-assigned unit number for this vehicle. Free text
  // (formats vary by agency), unique to them, not validated.
  unitNumber: text("unit_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuoteLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  partId?: string;
  // Weighted-average cost snapshotted at invoice conversion (Phase 2), so the
  // internal margin view reflects cost at the time of sale rather than today's
  // moving average. Absent on quotes not yet invoiced.
  avgCostSnap?: number;
};

export const parts = pgTable("parts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tags: text("tags").array(),
  sku: text("sku").unique().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  mfgPartNumber: text("mfg_part_number"),
  category: text("category"),
  quantityOnHand: integer("quantity_on_hand").notNull().default(0),
  quantityOnOrder: integer("quantity_on_order").notNull().default(0),
  reorderPoint: integer("reorder_point"),
  cost: numeric("cost", { precision: 12, scale: 2 }),
  // Weighted-average cost — the authoritative costing basis for work orders
  // (Phase 2). numeric(12,4): the average is a derived rate, not a posted
  // amount, and 2dp would decay under repeated receipts. Maintained by the
  // receive transaction as a moving average; `cost` above follows it at 2dp
  // (= ROUND(avg_cost, 2)). Null until the part's first receipt / opening layer.
  avgCost: numeric("avg_cost", { precision: 12, scale: 4 }),
  price: numeric("price", { precision: 12, scale: 2 }),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  manufacturerId: uuid("manufacturer_id").references(() => vendors.id),
  archived: boolean("archived").notNull().default(false),
  restricted: boolean("restricted").notNull().default(false),
  restrictionCategory: text("restriction_category"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("parts_sku_idx").on(t.sku)]);

// Provenance of a cost layer / issue. `individual` = full-price single-SKU buy,
// `package` = part of a vendor promo (Phase 3/4, carries promo_id), `backfill`
// = a reorder-point or reserved-override replacement PO (Phase 6), `opening` =
// an opening-balance layer seeded for stock that predates the layer table
// (Phase 2). Phase 7's savings report keys off this to tell package cost from
// full-price cost even under weighted-average, which smears the two together.
export const inventorySourceKind = pgEnum("inventory_source_kind", ["package", "individual", "backfill", "opening"]);

// Active costing method — an auditable accounting policy, not a per-call flag.
// weighted_average is primary (the work-order costing basis); fifo stays
// available as a second valuation. Switching applies forward only.
export const costingMethod = pgEnum("costing_method", ["weighted_average", "fifo"]);

// A cost layer. Each receipt (package, individual, backfill, or an opening
// balance) creates one with its own unit_cost and provenance; on-hand is the
// sum of remaining_qty across a part's layers. This IS the brief's
// `inventory_cost_layer` — extended in place rather than duplicated.
export const partReceipts = pgTable("part_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id").notNull().references(() => parts.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  // Provenance. Defaults to `individual` so pre-Phase-2 rows read correctly.
  sourceKind: inventorySourceKind("source_kind").notNull().default("individual"),
  // Set only for `package` layers, for Phase 7 reporting. FK to vendor_promo.
  promoId: uuid("promo_id").references((): AnyPgColumn => vendorPromo.id, { onDelete: "set null" }),
  quantityReceived: integer("quantity_received").notNull(),
  quantityRemaining: integer("quantity_remaining").notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull(),
  // Idempotency key for a receipt event (Phase 4). Unique when set; null for
  // opening-balance and legacy layers.
  receiptKey: text("receipt_key"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("part_receipts_part_idx").on(t.partId),
  index("part_receipts_received_at_idx").on(t.receivedAt),
  index("part_receipts_promo_idx").on(t.promoId),
  uniqueIndex("part_receipts_receipt_key_uq").on(t.receiptKey).where(sql`${t.receiptKey} IS NOT NULL`),
]);

// One row per layer-slice consumed. `qty` units of `part_id` drawn from a
// single `layer_id` at that layer's `unit_cost` (provenance). A single logical
// issue of N units can span several layers → several rows. The cost CHARGED to
// the job (the ledger) is method-dependent (avg vs FIFO) and lives in the
// journal; these rows are the quantity+provenance subledger Phase 7 reads.
export const inventoryIssue = pgTable("inventory_issue", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id").notNull().references(() => parts.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  layerId: uuid("layer_id").references(() => partReceipts.id, { onDelete: "set null" }),
  qty: integer("qty").notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
}, (t) => [
  index("inventory_issue_part_idx").on(t.partId),
  index("inventory_issue_work_order_idx").on(t.workOrderId),
  index("inventory_issue_layer_idx").on(t.layerId),
]);

// Single-row costing policy. The active method applies to every job costed
// after it is set; it never rewrites posted entries. Read via
// src/lib/costing.ts :: getCostingMethod (defaults to weighted_average if the
// row is absent).
export const costingPolicy = pgTable("costing_policy", {
  id: uuid("id").defaultRandom().primaryKey(),
  method: costingMethod("method").notNull().default("weighted_average"),
  changedBy: uuid("changed_by").references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const partCostHistory = pgTable("part_cost_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id").notNull().references(() => parts.id, { onDelete: "cascade" }),
  cost: numeric("cost", { precision: 12, scale: 2 }).notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  source: text("source"),
});

// Promo packages — Phase 1: vendor à la carte price list.
//
// One trustworthy source for what each part costs when bought individually
// from a given vendor. This à la carte cost is the allocation basis for
// package purchases (Phase 3) AND the pre-fill for individual PO lines
// (Phase 4) — deliberately NOT parts.cost, which under average costing drifts
// below à la carte once discounted package stock is received.
//
// Prices are date-ranged, never overwritten: changing a price closes the
// current row (stamps effective_to) and inserts a new one, so a historical PO
// stays explainable against the price that was live when it was placed. The
// "current" price for a SKU+vendor is the row whose [effective_from,
// effective_to) window covers today (effective_to null = still current).
//
// Keyed by (vendor_id, sku) rather than a parts FK: a price file can be loaded
// before the part exists in inventory, and the same manufacturer SKU can carry
// different net pricing from different distributors.
export const vendorPartPrice = pgTable("vendor_part_price", {
  id: uuid("id").defaultRandom().primaryKey(),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  alacarteUnitCost: numeric("alacarte_unit_cost", { precision: 12, scale: 2 }).notNull(),
  effectiveFrom: date("effective_from").notNull().default(sql`CURRENT_DATE`),
  effectiveTo: date("effective_to"),
  sourceNote: text("source_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("vendor_part_price_vendor_sku_idx").on(t.vendorId, t.sku),
  index("vendor_part_price_sku_idx").on(t.sku),
  // At most one current (effective_to IS NULL) price per vendor+sku. Enforced
  // as a partial unique index so history rows (effective_to set) don't collide.
  uniqueIndex("vendor_part_price_current_uq")
    .on(t.vendorId, t.sku)
    .where(sql`${t.effectiveTo} IS NULL`),
]);

// Promo packages — Phase 3: vendor promos and the allocation engine's data.
//
// A vendor_promo is one price for a fixed basket of parts (e.g. Whelen's
// "Inner Edge Regional Promo"). The single package price is spread across the
// lines in proportion to each line's à la carte cost (src/lib/promoAllocation.ts)
// so every part carries a fair share of the discount. Allocation is the ONLY
// place that logic lives, and it runs for a package purchase only — never for an
// individual PO line.
//
// Snapshot rule: each line snapshots its à la carte cost (alacarte_cost_snap)
// from vendor_part_price at save time, so a later price-list edit never
// retroactively changes an already-defined promo. The allocated cost itself is
// computed by the engine and snapshotted onto the PO line at PO creation
// (Phase 4), not stored here.
export const vendorPromoStatus = pgEnum("vendor_promo_status", ["active", "retired"]);

export const vendorPromo = pgTable("vendor_promo", {
  id: uuid("id").defaultRandom().primaryKey(),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  packagePrice: numeric("package_price", { precision: 12, scale: 2 }).notNull(),
  // Optional freight on the package. Folded into package_price before
  // allocation so it spreads across the parts the same way.
  freight: numeric("freight", { precision: 12, scale: 2 }),
  effectiveFrom: date("effective_from").notNull().default(sql`CURRENT_DATE`),
  effectiveTo: date("effective_to"),
  status: vendorPromoStatus("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("vendor_promo_vendor_idx").on(t.vendorId),
  index("vendor_promo_status_idx").on(t.status),
]);

export const vendorPromoLine = pgTable("vendor_promo_line", {
  id: uuid("id").defaultRandom().primaryKey(),
  promoId: uuid("promo_id").notNull().references(() => vendorPromo.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  quantity: integer("quantity").notNull().default(1),
  // Allocation basis, snapshotted from vendor_part_price at save time.
  alacarteCostSnap: numeric("alacarte_cost_snap", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("vendor_promo_line_promo_idx").on(t.promoId)]);

// Inventory packages (a.k.a. kits / canned services). A reusable bundle of
// parts + labor + fees the sales team can drop onto a quote in one click.
// Components are stored as a jsonb array — the same shape used by the quote
// editor's line items — so expanding a package onto a quote is a direct map.
// Pricing is itemized: each component becomes its own editable quote line, so
// the customer sees the full breakdown (chosen over a single fixed bundle
// price). Parts are linked by partId when known, but each component also
// snapshots a description + unit price so the package keeps working even if
// the underlying part is later archived or renamed.
export type PackageComponent =
  | {
      kind: "item";
      description: string;
      quantity: number;
      unitPrice: number;
      partId?: string | null;
      sku?: string | null;
    }
  | { kind: "labor"; description: string; hours: number; rate: number }
  | { kind: "fee"; description: string; amount: number; fixed: boolean };

export const packages = pgTable("packages", {
  id: uuid("id").defaultRandom().primaryKey(),
  archived: boolean("archived").notNull().default(false),
  tags: text("tags").array(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  components: jsonb("components").$type<PackageComponent[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("packages_name_idx").on(t.name)]);

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  archived: boolean("archived").notNull().default(false),
  tags: text("tags").array(),
  poNumber: text("po_number").unique(),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  status: purchaseOrderStatus("status").notNull().default("pending"),
  total: numeric("total", { precision: 12, scale: 2 }).default("0"),
  expectedAt: timestamp("expected_at"),
  receivedAt: timestamp("received_at"),
  lineItems: jsonb("line_items").$type<POLineItem[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Purchase-order line. Stored in purchase_orders.line_items (jsonb). Phase 4
// adds: a stable `id` (so receiving keys on identity, not array position, and
// can build an idempotent receipt key), `sku`, and the package-buy fields.
// `unitCost` is the ALLOCATED cost for a package line and the actual price paid
// for an individual line — always a 2-decimal value (money math goes through
// dollarsToCents, which rounds, so the JSON float never drifts).
export type POLineItem = {
  id?: string;
  partId?: string;
  sku?: string;
  description: string;
  quantity: number;
  quantityReceived: number;
  unitCost: number;
  // Set = this line is part of a package buy; carries the promo whose engine
  // produced unitCost. Null / absent = an individual (full-price) line.
  sourcePromoId?: string | null;
  // À la carte basis captured at PO time, for audit. Package lines only.
  alacarteCostSnap?: number | null;
  // Explicit provenance override for the cost layer written on receipt.
  // Defaults to 'package' when sourcePromoId is set, else 'individual';
  // Phase 6 sets 'backfill' on lines generated from a backfill requisition.
  sourceKind?: "package" | "individual" | "backfill";
};

export const workOrders = pgTable("work_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  archived: boolean("archived").notNull().default(false),
  tags: text("tags").array(),
  woNumber: text("wo_number").unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  quoteId: uuid("quote_id").references(() => quotes.id),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
  assignedTo: uuid("assigned_to").references(() => users.id),
  status: text("status").notNull().default("open"),
  priority: text("priority"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  buildSpec: jsonb("build_spec"),
  notes: text("notes"),
  partsConsumed: boolean("parts_consumed").notNull().default(false),
  targetBuildStartDate: timestamp("target_build_start_date"),
  safetyBufferDays: integer("safety_buffer_days").notNull().default(7),
  // Accounting Phase 5: when a job's WIP has been settled to COGS, this points
  // at the settling journal entry. Null = still open in WIP. Latches the
  // settlement so it can't be double-posted.
  cogsJournalEntryId: uuid("cogs_journal_entry_id").references((): AnyPgColumn => journalEntries.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const qcChecklists = pgTable("qc_checklists", {
  id: uuid("id").defaultRandom().primaryKey(),
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  items: jsonb("items").$type<QCItem[]>().default([]),
  completedBy: uuid("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QCItem = { label: string; passed: boolean; notes?: string; };

export const timeEntries = pgTable("time_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").references(() => workOrders.id),
  clockedInAt: timestamp("clocked_in_at").notNull().defaultNow(),
  clockedOutAt: timestamp("clocked_out_at"),
  // Geofence telemetry captured at each punch (added with the Time Clock UI).
  clockInLat: numeric("clock_in_lat", { precision: 10, scale: 6 }),
  clockInLng: numeric("clock_in_lng", { precision: 10, scale: 6 }),
  clockInDistanceMeters: numeric("clock_in_distance_meters", { precision: 10, scale: 1 }),
  clockInWithinGeofence: boolean("clock_in_within_geofence"),
  clockOutLat: numeric("clock_out_lat", { precision: 10, scale: 6 }),
  clockOutLng: numeric("clock_out_lng", { precision: 10, scale: 6 }),
  note: text("note"),
}, (t) => [
  index("time_entries_user_idx").on(t.userId),
  index("time_entries_work_order_idx").on(t.workOrderId),
  index("time_entries_open_idx").on(t.clockedOutAt),
]);

export const notes = pgTable("notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  body: text("body").notNull(),
  authorId: uuid("author_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const templates = pgTable("templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  body: jsonb("body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const customerDocuments = pgTable("customer_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  fileName: text("file_name").notNull(),
  blobUrl: text("blob_url").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  associatedDealId: uuid("associated_deal_id").references(() => deals.id, { onDelete: "set null" }),
  tags: jsonb("tags").$type<string[]>().default([]),
  notes: text("notes"),
  kind: text("kind"),
  version: integer("version").notNull().default(1),
  isCurrentVersion: boolean("is_current_version").notNull().default(true),
  parentDocumentId: uuid("parent_document_id").references((): AnyPgColumn => customerDocuments.id, { onDelete: "set null" }),
}, (t) => [
  index("customer_documents_customer_idx").on(t.customerId),
  index("customer_documents_category_idx").on(t.customerId, t.category),
  index("customer_documents_deal_idx").on(t.associatedDealId),
  index("customer_documents_current_idx").on(t.customerId, t.isCurrentVersion),
  index("customer_documents_kind_idx").on(t.kind),
]);

// Audit trail for every action on a customer_documents row. Captures
// upload / view / download / delete with the actor and (best-effort)
// IP. Surfaces on the customer entity page under the document folder.
export const documentAuditLog = pgTable("document_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").references(() => customerDocuments.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("document_audit_log_customer_idx").on(t.customerId),
  index("document_audit_log_document_idx").on(t.documentId),
]);

// Audit trail for every PDF generated by the universal export service.
// Captures who, what record, which template variant, how it was triggered
// (manual download, email, auto-generation, bulk export), and the resulting
// recipient (if emailed).
export const pdfAuditLog = pgTable("pdf_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  recordType: text("record_type").notNull(),
  recordId: uuid("record_id").notNull(),
  template: text("template").notNull(),
  purpose: text("purpose").notNull(),
  userId: uuid("user_id").references(() => users.id),
  recipient: text("recipient"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("pdf_audit_log_record_idx").on(t.recordType, t.recordId),
  index("pdf_audit_log_user_idx").on(t.userId),
]);

export const agentLogs = pgTable("agent_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  department: text("department").notNull(),
  agentName: text("agent_name").notNull(),
  prompt: text("prompt"),
  response: text("response"),
  contextEntityType: text("context_entity_type"),
  contextEntityId: uuid("context_entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const lookups = pgTable("lookups", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => lookups.id, { onDelete: "set null" }),
  value: text("value").notNull(),
  label: text("label"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("lookups_category_idx").on(t.category), index("lookups_parent_idx").on(t.parentId)]);

export const pipelines = pgTable("pipelines", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  config: jsonb("config"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const partners = pgTable("partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("dealership"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const partnerContacts = pgTable("partner_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  title: text("title"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("partner_contacts_partner_idx").on(t.partnerId)]);

export const dealActivity = pgTable("deal_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => dealActivity.id, { onDelete: "set null" }),
  authorId: uuid("author_id").references(() => users.id),
  kind: text("kind").notNull(),
  body: text("body"),
  metadata: jsonb("metadata"),
  mentions: jsonb("mentions").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("deal_activity_deal_idx").on(t.dealId)]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("notifications_user_idx").on(t.userId),
  index("notifications_unread_idx").on(t.userId, t.readAt),
]);

export const dealTasks = pgTable("deal_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  department: text("department"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: uuid("completed_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("deal_tasks_deal_idx").on(t.dealId)]);

export const dealCredentials = pgTable("deal_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  credentialType: text("credential_type").notNull(),
  credentialNumber: text("credential_number"),
  issuingAuthority: text("issuing_authority"),
  issuedDate: timestamp("issued_date"),
  expiresAt: timestamp("expires_at"),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: uuid("verified_by").references(() => users.id),
  documentUrl: text("document_url"),
  notes: text("notes"),
  restrictedEquipment: jsonb("restricted_equipment"),
  expirationNotifiedAt: timestamp("expiration_notified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("deal_credentials_deal_idx").on(t.dealId)]);

export const dealSpecs = pgTable("deal_specs", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  currentState: text("current_state").notNull().default("draft"),
  currentVersion: text("current_version"),
  approvedVersion: text("approved_version"),
  approvedAt: timestamp("approved_at"),
  approverName: text("approver_name"),
  approverTitle: text("approver_title"),
  approvalMethod: text("approval_method"),
  signedDocumentUrl: text("signed_document_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const specVersions = pgTable("spec_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  specId: uuid("spec_id").notNull().references(() => dealSpecs.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  stateSnapshot: text("state_snapshot").notNull(),
  body: jsonb("body").notNull(),
  authoredBy: uuid("authored_by").references(() => users.id),
  isChangeOrder: boolean("is_change_order").notNull().default(false),
  parentVersion: text("parent_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("spec_versions_spec_idx").on(t.specId)]);

export const customerMessages = pgTable("customer_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  direction: text("direction").notNull(),
  subject: text("subject"),
  body: text("body"),
  metadata: jsonb("metadata"),
  sentBy: uuid("sent_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("customer_messages_deal_idx").on(t.dealId)]);

// Upfit configurations. One per quote: vehicle body-style choice plus a
// jsonb array of pins (lights, sirens, equipment) placed onto the
// vehicle diagram. Drives both the in-app builder and the PDF spec
// sheet handed to techs.
export type UpfitPin = {
  id: string;
  number: number;
  // x/y are fractional 0..1 coordinates on the single composite vehicle
  // image. (`view` was used when each body style had five separate view
  // panels; kept optional for backward-compat with older saved configs.)
  view?: string;
  x: number;
  y: number;
  label: string;
  // Short caption rendered on the diagram next to the pin (e.g.
  // "VXE SMOKED LENS RED/WHITE"). Distinct from `notes`, which is an
  // internal placement note that prints in the equipment table only.
  caption?: string;
  // Visual config. All optional with defaults handled by the renderer
  // so existing pins (circles) keep working. `pushbar` renders a
  // push-bumper drawing rather than a colored equipment marker.
  shape?: "rect" | "circle" | "pushbar";
  size?:
    | "small"
    | "medium"
    | "large"
    | "strip_small"
    | "strip_medium"
    | "strip_large"
    | "strip";
  // Per-pin size override (0..1 fractions of the diagram, matching x/y).
  // When set, the renderer uses these instead of the preset size's
  // widthFrac/heightFrac so sales can fine-tune each pin by dragging a
  // resize handle on the diagram.
  widthFracOverride?: number;
  heightFracOverride?: number;
  // Color scheme slug — solid color, 50/50 split, or multi-segment.
  // See COLOR_SCHEMES in src/lib/upfit/templates.ts.
  colorScheme?: string;
  orientation?: "horizontal" | "vertical";
  partId?: string | null;
  partSku?: string | null;
  // Legacy single-color field (the old circle fill). Kept so older
  // saved pins still render; new pins use `colorScheme` instead.
  color?: string;
  notes?: string;
};

export const upfitConfigs = pgTable("upfit_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }).unique(),
  bodyStyle: text("body_style").notNull().default("suv"),
  // Human-readable make/model the diagram represents, e.g. "2024
  // Chevrolet Tahoe". Defaults from the linked deal/vehicle but is
  // editable so a spec can target a different unit than the deal record.
  vehicleLabel: text("vehicle_label"),
  pins: jsonb("pins").$type<UpfitPin[]>().notNull().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("upfit_configs_quote_idx").on(t.quoteId)]);

// ───────────────────────────────────────────────────────────────────────────
// ACCOUNTING MODULE — Phase 1: core double-entry ledger
//
// Money is stored as integer cents (bigint), never floating point. Every
// financial transaction is a `journal_entries` row made of two or more
// `journal_lines`; total debits must equal total credits. That balance rule —
// plus the immutability of posted entries — is enforced by DB triggers (see
// docs/sql/accounting_phase1.sql), not just app code.
// ───────────────────────────────────────────────────────────────────────────

export const glAccountType = pgEnum("gl_account_type", ["asset", "liability", "equity", "revenue", "expense"]);
// Drives how the P&L (Phase 6) groups each account. Balance-sheet accounts use "none".
export const glReportGroup = pgEnum("gl_report_group", ["revenue", "labor", "other_expense", "none"]);
export const glNormalBalance = pgEnum("gl_normal_balance", ["debit", "credit"]);
export const journalSource = pgEnum("journal_source", ["manual", "ar", "ap", "system"]);
export const journalStatus = pgEnum("journal_status", ["draft", "posted", "void"]);

// Cost centers. Seeded with exactly five: Admin, Upfitting, Mechanics,
// Body Shop, General. Every labor/material cost is tagged with one.
export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Chart of accounts. Named `gl_accounts` (not `accounts`) because `accounts`
// is already taken by the NextAuth OAuth-link table above.
export const glAccounts = pgTable("gl_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: glAccountType("type").notNull(),
  reportGroup: glReportGroup("report_group").notNull().default("none"),
  normalBalance: glNormalBalance("normal_balance").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("gl_accounts_type_idx").on(t.type)]);

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryDate: timestamp("entry_date").notNull().defaultNow(),
  memo: text("memo"),
  source: journalSource("source").notNull().default("manual"),
  status: journalStatus("status").notNull().default("draft"),
  // When this entry reverses another posted entry, points back at the original.
  reversesEntryId: uuid("reverses_entry_id").references((): AnyPgColumn => journalEntries.id),
  createdBy: uuid("created_by").references(() => users.id),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("journal_entries_status_idx").on(t.status),
  index("journal_entries_date_idx").on(t.entryDate),
]);

// Each line is EITHER a debit or a credit, never both (DB CHECK enforces it).
// Optional department/work-order tags let any cost be sliced by cost center
// or job. work_order_id stays nullable; work_orders already exists in this app.
export const journalLines = pgTable("journal_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => glAccounts.id),
  debitCents: bigint("debit_cents", { mode: "number" }).notNull().default(0),
  creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
  departmentId: uuid("department_id").references(() => departments.id),
  workOrderId: uuid("work_order_id").references(() => workOrders.id),
  memo: text("memo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("journal_lines_entry_idx").on(t.journalEntryId),
  index("journal_lines_account_idx").on(t.accountId),
  index("journal_lines_department_idx").on(t.departmentId),
  index("journal_lines_work_order_idx").on(t.workOrderId),
]);

// ───────────────────────────────────────────────────────────────────────────
// ACCOUNTING MODULE — Phase 2: Accounts Receivable
//
// An "invoice" is an existing quote we've decided to bill (stack decision:
// reuse quotes/customers rather than build a parallel invoices table). Issuing
// an invoice snapshots the quote's totals into `ar_invoices` and auto-posts a
// journal entry: Dr Accounts Receivable / Cr Sales Revenue / Cr Sales Tax
// Payable. A `receipts` row records cash in and auto-posts Dr Cash / Cr AR.
// Per-invoice open balance = invoice total − receipts applied to it.
// ───────────────────────────────────────────────────────────────────────────

export const arInvoiceStatus = pgEnum("ar_invoice_status", ["open", "paid", "void"]);
export const receiptMethod = pgEnum("receipt_method", ["cash", "check", "card", "ach", "other"]);

export const arInvoices = pgTable("ar_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  // One invoice per quote. Line items / detail stay on the quote; this row is
  // the AR posting record with the totals snapshotted at issue time so later
  // quote edits never change a posted invoice.
  quoteId: uuid("quote_id").notNull().unique().references(() => quotes.id),
  customerId: uuid("customer_id").references(() => customers.id),
  invoiceDate: timestamp("invoice_date").notNull().defaultNow(),
  dueDate: timestamp("due_date").notNull(),
  terms: text("terms").notNull().default("net_30"),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  status: arInvoiceStatus("status").notNull().default("open"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  memo: text("memo"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ar_invoices_status_idx").on(t.status),
  index("ar_invoices_customer_idx").on(t.customerId),
  index("ar_invoices_due_idx").on(t.dueDate),
]);

export const receipts = pgTable("receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  receiptNumber: text("receipt_number").notNull().unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  // Optional: a receipt can pay one invoice or sit on-account (invoice_id null).
  invoiceId: uuid("invoice_id").references(() => arInvoices.id),
  receiptDate: timestamp("receipt_date").notNull().defaultNow(),
  method: receiptMethod("method").notNull().default("check"),
  reference: text("reference"),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
  memo: text("memo"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("receipts_customer_idx").on(t.customerId),
  index("receipts_invoice_idx").on(t.invoiceId),
  index("receipts_date_idx").on(t.receiptDate),
]);

// ───────────────────────────────────────────────────────────────────────────
// ACCOUNTING MODULE — Phase 3: Accounts Payable
//
// A `bill` is a vendor invoice we owe, made of one or more `bill_lines` (each
// posts to a chosen expense/asset account, optionally tagged with a department
// or work order for cost accounting). Posting a bill auto-creates a journal
// entry: Dr each line's account / Cr Accounts Payable. A `payment` pays a bill
// (or sits on-account) and posts Dr Accounts Payable / Cr Cash. Per-bill open
// balance = bill total − payments applied to it.
// ───────────────────────────────────────────────────────────────────────────

export const billStatus = pgEnum("bill_status", ["open", "paid", "void"]);
export const paymentMethod = pgEnum("payment_method", ["check", "ach", "card", "cash", "other"]);

export const bills = pgTable("bills", {
  id: uuid("id").defaultRandom().primaryKey(),
  billNumber: text("bill_number").notNull().unique(),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  // The vendor's own invoice number, for matching against their paperwork.
  vendorInvoiceNumber: text("vendor_invoice_number"),
  // Optional link to a purchase order this bill settles.
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
  billDate: timestamp("bill_date").notNull().defaultNow(),
  dueDate: timestamp("due_date").notNull(),
  terms: text("terms").notNull().default("net_30"),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  status: billStatus("status").notNull().default("open"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  memo: text("memo"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("bills_status_idx").on(t.status),
  index("bills_vendor_idx").on(t.vendorId),
  index("bills_due_idx").on(t.dueDate),
]);

export const billLines = pgTable("bill_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => glAccounts.id),
  description: text("description"),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
  departmentId: uuid("department_id").references(() => departments.id),
  workOrderId: uuid("work_order_id").references(() => workOrders.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("bill_lines_bill_idx").on(t.billId),
  index("bill_lines_account_idx").on(t.accountId),
]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentNumber: text("payment_number").notNull().unique(),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  // Optional: a payment can settle one bill or sit on-account (bill_id null).
  billId: uuid("bill_id").references(() => bills.id),
  paymentDate: timestamp("payment_date").notNull().defaultNow(),
  method: paymentMethod("method").notNull().default("check"),
  reference: text("reference"),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
  memo: text("memo"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("payments_vendor_idx").on(t.vendorId),
  index("payments_bill_idx").on(t.billId),
  index("payments_date_idx").on(t.paymentDate),
]);

// ───────────────────────────────────────────────────────────────────────────
// ACCOUNTING MODULE — Phase 5: Job costing
//
// Materials already flow to Work in Progress tagged with work_order_id
// (Phase 4). Labor is derived from the existing `time_entries` (hours) valued
// at an hourly cost rate. `labor_rates` holds those rates: one row per user,
// plus an optional shop-wide default (user_id NULL). Closing a job settles its
// accumulated WIP to COGS (Dr COGS / Cr WIP) — see src/lib/jobCosting.ts.
// ───────────────────────────────────────────────────────────────────────────

export const laborRates = pgTable("labor_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  // NULL = the shop-wide default rate; otherwise the per-user override.
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  rateCents: bigint("rate_cents", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("labor_rates_user_uidx").on(t.userId),
  // Postgres treats NULLs as distinct, so the index above never constrained the
  // shop-default row and several could exist — which made "the" default rate
  // non-deterministic. This partial index is the actual one-default rule. See
  // "Labor cost per build" in docs/REQUIREMENTS.md for the SQL to add it to an
  // existing database.
  uniqueIndex("labor_rates_single_default_uidx")
    .on(sql`(${t.userId} IS NULL)`)
    .where(sql`${t.userId} IS NULL`),
]);

// ───────────────────────────────────────────────────────────────────────────
// ACCOUNTING MODULE — Phase 7: AR/AP agents (draft-only)
//
// Server-side Claude calls DRAFT content — an AR overdue-reminder email, or an
// AP payment-schedule / anomaly analysis — and never act externally. Every
// draft lands here as `pending` and a human Approves, Edits, or Rejects it,
// with the decision + reviewer logged. Nothing is ever sent or paid by the
// agent; approval is an internal sign-off, not an external action.
// ───────────────────────────────────────────────────────────────────────────

export const agentKind = pgEnum("agent_kind", ["ar_reminder", "ap_schedule"]);
export const agentDraftStatus = pgEnum("agent_draft_status", ["pending", "approved", "rejected"]);

export const agentDrafts = pgTable("agent_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: agentKind("kind").notNull(),
  status: agentDraftStatus("status").notNull().default("pending"),
  title: text("title").notNull(),
  // The model's draft, and (once a human edits it) the edited version they signed off on.
  content: text("content").notNull(),
  editedContent: text("edited_content"),
  // What the draft was generated from (invoice id, bill snapshot, etc.) for audit.
  context: jsonb("context"),
  // Optional link to the AR invoice a reminder is about.
  invoiceId: uuid("invoice_id").references(() => arInvoices.id),
  model: text("model"),
  createdBy: uuid("created_by").references(() => users.id),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("agent_drafts_kind_idx").on(t.kind),
  index("agent_drafts_status_idx").on(t.status),
]);

// ───────────────────────────────────────────────────────────────────────────
// ACCOUNTING MODULE — Phase 8: Tax / government tracking
//
// Tax liability lives in the ledger (Sales Tax Payable, account 2100): quotes
// that carry tax credit it when invoiced (Phase 2), and remitting tax to the
// government debits it. This phase adds a **configurable** rate table (no
// hardcoded rates — the team enters jurisdictions + rates) and period filing
// summaries computed from the 2100 ledger activity. Not tax advice — the UI
// carries a "confirm with a qualified accountant" disclaimer.
// ───────────────────────────────────────────────────────────────────────────

export const taxRates = pgTable("tax_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  jurisdiction: text("jurisdiction").notNull(),
  // Percent, e.g. 8.25 — stored as entered; never hardcoded in code.
  ratePct: numeric("rate_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("tax_rates_active_idx").on(t.isActive)]);

// ───────────────────────────────────────────────────────────────────────────
// ACCOUNTING MODULE — Phase 9: QuickBooks Online integration (LAST)
//
// Connect to Intuit via OAuth 2.0, map our chart of accounts to QBO accounts,
// pull payroll labor totals for P&L reconciliation, and one-direction sync into
// a QBO SANDBOX first — production requires an explicit, separate confirmation.
// Every attempt writes a `qbo_sync_log` row. Intuit credentials come from env
// (QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI); until they're set the
// screens are inert and say so.
// ───────────────────────────────────────────────────────────────────────────

export const qboEnvironment = pgEnum("qbo_environment", ["sandbox", "production"]);

// Single-row connection/config record (id is a fixed sentinel in app code).
export const qboSettings = pgTable("qbo_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  environment: qboEnvironment("environment").notNull().default("sandbox"),
  realmId: text("realm_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  connectedAt: timestamp("connected_at"),
  // Random string tying an in-flight OAuth authorize request to its callback.
  authState: text("auth_state"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Maps one of our gl_accounts to a QBO account (by QBO id + name).
export const qboAccountMap = pgTable("qbo_account_map", {
  id: uuid("id").defaultRandom().primaryKey(),
  glAccountId: uuid("gl_account_id").notNull().unique().references(() => glAccounts.id, { onDelete: "cascade" }),
  qboAccountId: text("qbo_account_id"),
  qboAccountName: text("qbo_account_name"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("qbo_account_map_gl_idx").on(t.glAccountId)]);

export const qboSyncLog = pgTable("qbo_sync_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: text("action").notNull(), // e.g. "connect", "payroll_import", "coa_map"
  direction: text("direction"), // "auth" | "from_qbo" | "to_qbo" | null
  status: text("status").notNull(), // "ok" | "error" | "info"
  message: text("message"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("qbo_sync_log_created_idx").on(t.createdAt)]);

export const usersRelations = relations(users, ({ many }) => ({ deals: many(deals), timeEntries: many(timeEntries), notes: many(notes) }));
export const customersRelations = relations(customers, ({ many }) => ({ deals: many(deals), quotes: many(quotes), workOrders: many(workOrders) }));
export const dealsRelations = relations(deals, ({ one }) => ({ customer: one(customers, { fields: [deals.customerId], references: [customers.id] }), assignee: one(users, { fields: [deals.assignedTo], references: [users.id] }) }));
export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({ customer: one(customers, { fields: [workOrders.customerId], references: [customers.id] }), vehicle: one(vehicles, { fields: [workOrders.vehicleId], references: [vehicles.id] }), qcChecklists: many(qcChecklists), timeEntries: many(timeEntries) }));
