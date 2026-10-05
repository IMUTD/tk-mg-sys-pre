ALTER TABLE "device" ADD CONSTRAINT "device_group_id_unique" UNIQUE ("id", "group_id");--> statement-breakpoint
ALTER TABLE "device_instance" ADD CONSTRAINT "device_instance_id_device_unique" UNIQUE ("id", "device_id");--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "claimed_at" timestamptz;--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "lease_expires_at" timestamptz;--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "cancel_requested_at" timestamptz;--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "cancel_error_code" text;--> statement-breakpoint
DROP INDEX "device_command_group_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "device_command_group_device_key_unique" ON "device_command" ("group_id", "device_id", "idempotency_key");--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_group_fk" FOREIGN KEY ("group_id") REFERENCES "access_group"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_device_fk" FOREIGN KEY ("device_id", "group_id") REFERENCES "device"("id", "group_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_instance_fk" FOREIGN KEY ("instance_id", "device_id") REFERENCES "device_instance"("id", "device_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_requester_fk" FOREIGN KEY ("requester_id") REFERENCES "app_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_timeout_check" CHECK ("timeout_ms" BETWEEN 1 AND 30000);--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_attempt_check" CHECK ("attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_kind_check" CHECK ("kind" IN ('health_check','capture_screen','launch_app','stop_app','tap','swipe','input_text'));--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_status_check" CHECK ("status" IN ('queued','running','succeeded','failed','timed_out','cancelled'));--> statement-breakpoint
CREATE INDEX "device_command_active_device_index" ON "device_command" ("device_id", "instance_id") WHERE "status" IN ('queued','running');
