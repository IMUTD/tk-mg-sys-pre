CREATE TYPE "public"."operation_task_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "operation_task_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "public"."access_group"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "operation_task" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "public"."access_group"("id") ON DELETE cascade,
  "template_id" uuid REFERENCES "public"."operation_task_template"("id") ON DELETE set null,
  "name" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" "operation_task_status" DEFAULT 'queued' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "error_code" text,
  "next_run_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "operation_task_group_idempotency_unique" UNIQUE("group_id", "idempotency_key")
);--> statement-breakpoint
CREATE TABLE "operation_task_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "public"."operation_task"("id") ON DELETE cascade,
  "attempt" integer NOT NULL,
  "level" text NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "operation_task_allocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "public"."operation_task"("id") ON DELETE cascade,
  "resource_id" uuid REFERENCES "public"."operation_resource"("id") ON DELETE set null,
  "account_id" uuid REFERENCES "public"."operation_account"("id") ON DELETE set null,
  "released_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "operation_task_group_created_index" ON "operation_task" USING btree ("group_id", "created_at");--> statement-breakpoint
CREATE INDEX "operation_task_run_task_created_index" ON "operation_task_run" USING btree ("task_id", "created_at");--> statement-breakpoint
CREATE INDEX "operation_task_allocation_active_index" ON "operation_task_allocation" USING btree ("task_id") WHERE "released_at" IS NULL;
