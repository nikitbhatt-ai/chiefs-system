import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  pgEnum,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const userRole = pgEnum("user_role", [
  "admin",
  "manager",
  "sales",
  "warehouse",
  "tech",
  "accountant",
]);

export const customerType = pgEnum("customer_type", [
  "government",
  "commercial",
  "retail",
]);

export const dealStage = pgEnum("deal_stage", [
  "prospect",
  "quote_sent",
  "po_received",
  "in_production",
  "delivered",
  "lost",
]);

export const leadStatus = pgEnum("lead_status", [
  "new",
  "contacted",
  "converted",
  "lost",
]);

export const quoteStatus = pgEnum("quote_status", [
  "draft",
  "sent",
  "approved",
  "converted",
]);

export const purchaseOrderStatus = pgEnum("purchase_order_status", [
  "pending",
  "pending_review",
  "po_received",
  "partially_received",
  "received",
]);

export const vehicleStatus = pgEnum("vehicle_status", [
  "new",
  "received",
  "ready_for_pickup",
  "delivered",
  "sold",
]);

export const commType = pgEnum("comm_type", [
  "call",
  "email",
  "in_person",
  "note",
]);

// ── Auth.js core tables ─────────────────────────────────────────────────────

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

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ── Domain tables ───────────────────────────────────────────────────────────

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
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

export const vehicles = pgTable(
  "vehicles",
  {
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
    photos: jsonb("photos").$type<string[]>().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("vehicles_status_idx").on(t.status)],
);

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source"),
  status: leadStatus("status").notNull().default("new"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  notes: text("notes"),
  convertedCustomerId: uuid("converted_customer_id").references(() => customers.id),
  convertedDealId: uuid("converted_deal_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id),
    assignedTo: uuid("assigned_to").references(() => users.id),
    salesRep: text("sales_rep"),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    vehicleYear: integer("vehicle_year"),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vin: text("vin"),
    stage: dealStage("stage").notNull().default("prospect"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("deals_stage_idx").on(t.stage),
    index("deals_customer_idx").on(t.customerId),
  ],
);

export const dealComms = pgTable("deal_comms", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  type: commType("type").notNull(),
  lastContactDate: timestamp("last_contact_date").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const quotes = pgTable("quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteNumber: text("quote_number").unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  dealId: uuid("deal_id").references(() => deals.id),
  status: quoteStatus("status").notNull().default("draft"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).default("0"),
  taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).default("0"),
  grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).default("0"),
  lineItems: jsonb("line_items").$type<QuoteLineItem[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuoteLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  partId?: string;
};

export const parts = pgTable(
  "parts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sku: text("sku").unique().notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    quantityOnOrder: integer("quantity_on_order").notNull().default(0),
    reorderPoint: integer("reorder_point"),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    price: numeric("price", { precision: 12, scale: 2 }),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    manufacturerId: uuid("manufacturer_id").references(() => vendors.id),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("parts_sku_idx").on(t.sku)],
);

// One row per discrete receipt of a part from a PO. Drives FIFO + weighted
// avg costing. quantityRemaining decrements as the part is consumed
// (work-order parts or sales). On creation, quantityRemaining === quantityReceived.
export const partReceipts = pgTable(
  "part_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "set null",
    }),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    quantityReceived: integer("quantity_received").notNull(),
    quantityRemaining: integer("quantity_remaining").notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("part_receipts_part_idx").on(t.partId),
    index("part_receipts_received_at_idx").on(t.receivedAt),
  ],
);

export const partCostHistory = pgTable("part_cost_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id")
    .notNull()
    .references(() => parts.id, { onDelete: "cascade" }),
  cost: numeric("cost", { precision: 12, scale: 2 }).notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  source: text("source"),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
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

export type POLineItem = {
  partId?: string;
  description: string;
  quantity: number;
  quantityReceived: number;
  unitCost: number;
};

export const workOrders = pgTable("work_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  woNumber: text("wo_number").unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  quoteId: uuid("quote_id").references(() => quotes.id),
  assignedTo: uuid("assigned_to").references(() => users.id),
  status: text("status").notNull().default("open"),
  priority: text("priority"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  buildSpec: jsonb("build_spec"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const qcChecklists = pgTable("qc_checklists", {
  id: uuid("id").defaultRandom().primaryKey(),
  workOrderId: uuid("work_order_id")
    .notNull()
    .references(() => workOrders.id, { onDelete: "cascade" }),
  items: jsonb("items").$type<QCItem[]>().default([]),
  completedBy: uuid("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QCItem = {
  label: string;
  passed: boolean;
  notes?: string;
};

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workOrderId: uuid("work_order_id").references(() => workOrders.id),
    clockedInAt: timestamp("clocked_in_at").notNull().defaultNow(),
    clockedOutAt: timestamp("clocked_out_at"),
    note: text("note"),
  },
  (t) => [index("time_entries_user_idx").on(t.userId)],
);

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

export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    blobUrl: text("blob_url").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => [index("files_entity_idx").on(t.entityType, t.entityId)],
);

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

// ── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  deals: many(deals),
  timeEntries: many(timeEntries),
  notes: many(notes),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  deals: many(deals),
  quotes: many(quotes),
  workOrders: many(workOrders),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  customer: one(customers, {
    fields: [deals.customerId],
    references: [customers.id],
  }),
  assignee: one(users, {
    fields: [deals.assignedTo],
    references: [users.id],
  }),
  comms: many(dealComms),
}));

export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [workOrders.customerId],
    references: [customers.id],
  }),
  vehicle: one(vehicles, {
    fields: [workOrders.vehicleId],
    references: [vehicles.id],
  }),
  qcChecklists: many(qcChecklists),
  timeEntries: many(timeEntries),
}));
