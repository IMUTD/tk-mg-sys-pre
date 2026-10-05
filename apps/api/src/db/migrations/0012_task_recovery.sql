ALTER TABLE "operation_task" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operation_task" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "operation_task_running_heartbeat_index" ON "operation_task" USING btree ("heartbeat_at") WHERE "status" = 'running';
