ALTER TABLE "operation_task" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "operation_task_claim" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "public"."operation_task"("id") ON DELETE cascade,
  "group_id" uuid NOT NULL REFERENCES "public"."access_group"("id") ON DELETE cascade,
  "claim_kind" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "released_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX "operation_task_claim_active_unique" ON "operation_task_claim" USING btree ("claim_kind", "entity_id") WHERE "released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "operation_task_claim_task_active_index" ON "operation_task_claim" USING btree ("task_id") WHERE "released_at" IS NULL;
