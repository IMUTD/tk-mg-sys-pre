ALTER TABLE "operation_task_run" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "operation_task_allocation" ADD COLUMN "group_id" uuid REFERENCES "public"."access_group"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "operation_task_allocation_group_active_index" ON "operation_task_allocation" USING btree ("group_id") WHERE "released_at" IS NULL;
