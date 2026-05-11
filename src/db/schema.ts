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
  photos: jsonb("photos").$type<string[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("vehicles_status_idx").on(t.status)]);

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
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
  partnerId: uuid("partner_id"),
  partnerContactId: uuid("partner_contact_id"),
  convertedCustomerId: uuid("converted_customer_id").references(() => customers.id),
  convertedDealId: uuid("converted_deal_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const deals = pgTable("deals", {
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
  referralSource: text("referral_source"),
  notes: text("notes"),
  pipeline: text("pipeline"),
  source: text("source"),
  subSource: text("sub_source"),
  subSourceMeta: jsonb("sub_source_meta"),
  partnerId: uuid("partner_id"),
  partnerContactId: uuid("partner_contact_id"),
  sourceLocked: boolean("source_locked").notNull().default(false),
  department: text("department"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("deals_stage_idx").on(t.stage),
  index("deals_customer_idx").on(t.customerId),
  index("deals_pipeline_idx").on(t.pipeline),
]);

export const dealComms = pgTable("deal_comms", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
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
  workflowStage: text("workflow_stage").notNull().default("estimate"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuoteLineItem = { description: string; quantity: number; unitPrice: number; total: number; partId?: string; };

export const parts = pgTable("parts", {
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
  restricted: boolean("restricted").notNull().default(false),
  restrictionCategory: text("restriction_category"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("parts_sku_idx").on(t.sku)]);

export const partReceipts = pgTable("part_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id").notNull().references(() => parts.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id").references(() => vendors.id),
  quantityReceived: integer("quantity_received").notNull(),
  quantityRemaining: integer("quantity_remaining").notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("part_receipts_part_idx").on(t.partId), index("part_receipts_received_at_idx").on(t.receivedAt)]);

export const partCostHistory = pgTable("part_cost_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id").notNull().references(() => parts.id, { onDelete: "cascade" }),
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

export type POLineItem = { partId?: string; description: string; quantity: number; quantityReceived: number; unitCost: number; };

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
  partsConsumed: boolean("parts_consumed").notNull().default(false),
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
  note: text("note"),
}, (t) => [index("time_entries_user_idx").on(t.userId)]);

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

export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  blobUrl: text("blob_url").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  kind: text("kind"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, (t) => [index("files_entity_idx").on(t.entityType, t.entityId), index("files_kind_idx").on(t.kind)]);

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
  parentId: uuid("parent_id"),
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
  parentId: uuid("parent_id"),
  authorId: uuid("author_id").references(() => users.id),
  kind: text("kind").notNull(),
  body: text("body"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("deal_activity_deal_idx").on(t.dealId)]);

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

export const usersRelations = relations(users, ({ many }) => ({ deals: many(deals), timeEntries: many(timeEntries), notes: many(notes) }));
export const customersRelations = relations(customers, ({ many }) => ({ deals: many(deals), quotes: many(quotes), workOrders: many(workOrders) }));
export const dealsRelations = relations(deals, ({ one, many }) => ({ customer: one(customers, { fields: [deals.customerId], references: [customers.id] }), assignee: one(users, { fields: [deals.assignedTo], references: [users.id] }), comms: many(dealComms) }));
export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({ customer: one(customers, { fields: [workOrders.customerId], references: [customers.id] }), vehicle: one(vehicles, { fields: [workOrders.vehicleId], references: [vehicles.id] }), qcChecklists: many(qcChecklists), timeEntries: many(timeEntries) }));
