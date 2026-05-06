CREATE TYPE "public"."comm_type" AS ENUM('call', 'email', 'in_person', 'note');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('government', 'commercial', 'retail');--> statement-breakpoint
CREATE TYPE "public"."deal_stage" AS ENUM('prospect', 'quote_sent', 'po_received', 'in_production', 'delivered', 'lost');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'converted', 'lost');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('pending', 'pending_review', 'po_received', 'partially_received', 'received');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'approved', 'converted');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager', 'sales', 'warehouse', 'tech', 'accountant');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('new', 'received', 'ready_for_pickup', 'delivered', 'sold');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "agent_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department" text NOT NULL,
	"agent_name" text NOT NULL,
	"prompt" text,
	"response" text,
	"context_entity_type" text,
	"context_entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "customer_type" DEFAULT 'commercial' NOT NULL,
	"address" text,
	"email" text,
	"phone" text,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_comms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"type" "comm_type" NOT NULL,
	"last_contact_date" timestamp NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"assigned_to" uuid,
	"sales_rep" text,
	"vehicle_id" uuid,
	"vehicle_year" integer,
	"vehicle_make" text,
	"vehicle_model" text,
	"vin" text,
	"stage" "deal_stage" DEFAULT 'prospect' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"blob_url" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_by" uuid,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"source" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"notes" text,
	"converted_customer_id" uuid,
	"converted_deal_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_cost_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"cost" numeric(12, 2) NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"quantity_on_order" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer,
	"cost" numeric(12, 2),
	"price" numeric(12, 2),
	"vendor_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "parts_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text,
	"vendor_id" uuid,
	"status" "purchase_order_status" DEFAULT 'pending' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0',
	"expected_at" timestamp,
	"received_at" timestamp,
	"line_items" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "qc_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb,
	"completed_by" uuid,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_number" text,
	"customer_id" uuid,
	"deal_id" uuid,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0',
	"tax_total" numeric(12, 2) DEFAULT '0',
	"grand_total" numeric(12, 2) DEFAULT '0',
	"line_items" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_quote_number_unique" UNIQUE("quote_number")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"body" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_order_id" uuid,
	"clocked_in_at" timestamp DEFAULT now() NOT NULL,
	"clocked_out_at" timestamp,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"name" text,
	"image" text,
	"username" text,
	"display_name" text,
	"password_hash" text,
	"role" "user_role" DEFAULT 'sales' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vin" text,
	"year" integer,
	"make" text,
	"model" text,
	"trim" text,
	"color" text,
	"mileage" integer,
	"status" "vehicle_status" DEFAULT 'new' NOT NULL,
	"lot_location" text,
	"purchase_price" numeric(12, 2),
	"list_price" numeric(12, 2),
	"photos" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wo_number" text,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"quote_id" uuid,
	"assigned_to" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"build_spec" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_wo_number_unique" UNIQUE("wo_number")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_comms" ADD CONSTRAINT "deal_comms_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_customer_id_customers_id_fk" FOREIGN KEY ("converted_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_cost_history" ADD CONSTRAINT "part_cost_history_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_checklists" ADD CONSTRAINT "qc_checklists_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_checklists" ADD CONSTRAINT "qc_checklists_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "deals_customer_idx" ON "deals" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "files_entity_idx" ON "files" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "parts_sku_idx" ON "parts" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicles_status_idx" ON "vehicles" USING btree ("status");