CREATE TYPE "public"."operation_account_status" AS ENUM('ready', 'suspended', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."operation_proxy_status" AS ENUM('ready', 'unavailable', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."operation_resource_status" AS ENUM('available', 'allocated', 'inactive');--> statement-breakpoint
CREATE TABLE "operation_resource" (
  "category" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "group_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "status" "operation_resource_status" DEFAULT 'available' NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "operation_account" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "encrypted_secret" text NOT NULL,
  "group_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identifier" text NOT NULL,
  "name" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "status" "operation_account_status" DEFAULT 'ready' NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "operation_account_group_identifier_unique" UNIQUE("group_id", "identifier")
);--> statement-breakpoint
CREATE TABLE "operation_account_lease" (
  "account_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "group_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "leased_by_user_id" uuid NOT NULL,
  "released_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "operation_resource_allocation" (
  "account_id" uuid NOT NULL,
  "allocated_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "group_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "released_at" timestamp with time zone,
  "resource_id" uuid NOT NULL
);--> statement-breakpoint
CREATE TABLE "operation_proxy" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "encrypted_credentials" text NOT NULL,
  "endpoint" text NOT NULL,
  "group_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "status" "operation_proxy_status" DEFAULT 'ready' NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "operation_resource" ADD CONSTRAINT "operation_resource_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_account" ADD CONSTRAINT "operation_account_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_account_lease" ADD CONSTRAINT "operation_account_lease_account_id_operation_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."operation_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_account_lease" ADD CONSTRAINT "operation_account_lease_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_account_lease" ADD CONSTRAINT "operation_account_lease_leased_by_user_id_app_user_id_fk" FOREIGN KEY ("leased_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_resource_allocation" ADD CONSTRAINT "operation_resource_allocation_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."operation_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_resource_allocation" ADD CONSTRAINT "operation_resource_allocation_actor_fk" FOREIGN KEY ("allocated_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_resource_allocation" ADD CONSTRAINT "operation_resource_allocation_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_resource_allocation" ADD CONSTRAINT "operation_resource_allocation_resource_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."operation_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_proxy" ADD CONSTRAINT "operation_proxy_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_resource_group_created_index" ON "operation_resource" USING btree ("group_id", "created_at");--> statement-breakpoint
CREATE INDEX "operation_account_group_created_index" ON "operation_account" USING btree ("group_id", "created_at");--> statement-breakpoint
CREATE INDEX "operation_account_lease_group_created_index" ON "operation_account_lease" USING btree ("group_id", "created_at");--> statement-breakpoint
CREATE INDEX "operation_resource_allocation_resource_created_index" ON "operation_resource_allocation" USING btree ("resource_id", "created_at");--> statement-breakpoint
CREATE INDEX "operation_proxy_group_created_index" ON "operation_proxy" USING btree ("group_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_account_lease_active_unique" ON "operation_account_lease" USING btree ("account_id") WHERE "released_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_resource_allocation_active_unique" ON "operation_resource_allocation" USING btree ("resource_id") WHERE "released_at" IS NULL;
