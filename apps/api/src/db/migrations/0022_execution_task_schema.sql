CREATE TABLE "execution_task" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL,
  "requester_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "name" text NOT NULL,
  "executor_key" text NOT NULL,
  "parameters" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "next_retry_at" timestamptz,
  "last_retry_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "cancel_requested_at" timestamptz,
  "terminal_reason" text,
  "error_code" text,
  "error_message" text,
  "result" jsonb,
  CONSTRAINT "execution_task_group_fk" FOREIGN KEY ("group_id") REFERENCES "access_group"("id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_requester_fk" FOREIGN KEY ("requester_id") REFERENCES "app_user"("id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_device_group_fk" FOREIGN KEY ("device_id", "group_id") REFERENCES "device"("id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_id_group_unique" UNIQUE ("id", "group_id"),
  CONSTRAINT "execution_task_status_check" CHECK ("status" IN ('queued','dispatching','running','cancel_requested','cancelled','retry_waiting','succeeded','failed','timed_out')),
  CONSTRAINT "execution_task_retry_count_check" CHECK ("retry_count" >= 0 AND "max_attempts" > 0 AND "retry_count" <= "max_attempts")
);--> statement-breakpoint
CREATE UNIQUE INDEX "execution_task_group_idempotency_unique" ON "execution_task" ("group_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "execution_task_group_created_index" ON "execution_task" ("group_id", "created_at");--> statement-breakpoint
CREATE INDEX "execution_task_status_retry_index" ON "execution_task" ("status", "next_retry_at");--> statement-breakpoint

CREATE TABLE "execution_task_step" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "command_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "command_idempotency_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "kind" text NOT NULL,
  "target" jsonb NOT NULL,
  "parameters" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "result" jsonb,
  "error_code" text,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  CONSTRAINT "execution_task_step_task_group_fk" FOREIGN KEY ("task_id", "group_id") REFERENCES "execution_task"("id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_step_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "execution_task_step_status_check" CHECK ("status" IN ('pending','claimed','running','succeeded','failed','timed_out','cancelled','skipped'))
);--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD CONSTRAINT "execution_task_step_id_task_group_unique" UNIQUE ("id", "task_id", "group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_task_step_task_sequence_unique" ON "execution_task_step" ("task_id", "sequence");--> statement-breakpoint
CREATE INDEX "execution_task_step_task_status_index" ON "execution_task_step" ("task_id", "status");--> statement-breakpoint

CREATE TABLE "execution_task_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "source" text NOT NULL,
  "reason" text,
  "actor_id" uuid,
  "worker_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "execution_task_event_task_group_fk" FOREIGN KEY ("task_id", "group_id") REFERENCES "execution_task"("id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_event_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_event_to_status_check" CHECK ("to_status" IN ('queued','dispatching','running','cancel_requested','cancelled','retry_waiting','succeeded','failed','timed_out'))
);--> statement-breakpoint
ALTER TABLE "execution_task_event" ADD CONSTRAINT "execution_task_event_id_task_group_unique" UNIQUE ("id", "task_id", "group_id");--> statement-breakpoint
CREATE INDEX "execution_task_event_task_created_index" ON "execution_task_event" ("task_id", "created_at");--> statement-breakpoint

CREATE TABLE "execution_task_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "claimed_at" timestamptz,
  "claimed_by" text,
  "claim_expires_at" timestamptz,
  "delivered_at" timestamptz,
  "dead_lettered_at" timestamptz,
  "event_type" text NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "execution_task_outbox_task_group_fk" FOREIGN KEY ("task_id", "group_id") REFERENCES "execution_task"("id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_outbox_event_task_group_fk" FOREIGN KEY ("event_id", "task_id", "group_id") REFERENCES "execution_task_event"("id", "task_id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_outbox_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "execution_task_outbox_status_check" CHECK ("status" IN ('pending','claimed','delivered','dead_letter'))
);--> statement-breakpoint
CREATE INDEX "execution_task_outbox_claim_index" ON "execution_task_outbox" ("available_at", "claimed_at");--> statement-breakpoint
CREATE INDEX "execution_task_outbox_task_index" ON "execution_task_outbox" ("task_id", "created_at");--> statement-breakpoint

CREATE TABLE "execution_task_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "step_id" uuid,
  "attempt" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'claimed',
  "worker_id" text NOT NULL,
  "claim_token" text,
  "claim_expires_at" timestamptz,
  "heartbeat_at" timestamptz,
  "recovery_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "error_code" text,
  CONSTRAINT "execution_task_run_task_group_fk" FOREIGN KEY ("task_id", "group_id") REFERENCES "execution_task"("id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_run_step_task_group_fk" FOREIGN KEY ("step_id", "task_id", "group_id") REFERENCES "execution_task_step"("id", "task_id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_run_status_check" CHECK ("status" IN ('claimed','running','succeeded','failed','timed_out','cancelled','recovered')),
  CONSTRAINT "execution_task_run_attempt_check" CHECK ("attempt" > 0)
);--> statement-breakpoint
CREATE INDEX "execution_task_run_task_created_index" ON "execution_task_run" ("task_id", "created_at");--> statement-breakpoint
CREATE INDEX "execution_task_run_claim_index" ON "execution_task_run" ("status", "claim_expires_at");--> statement-breakpoint

CREATE TABLE "execution_task_device_lease" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "instance_id" uuid,
  "lease_token" text NOT NULL,
  "worker_id" text,
  "acquired_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "heartbeat_at" timestamptz,
  "released_at" timestamptz,
  "recovery_reason" text,
  CONSTRAINT "execution_task_device_lease_task_group_fk" FOREIGN KEY ("task_id", "group_id") REFERENCES "execution_task"("id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_device_lease_device_group_fk" FOREIGN KEY ("device_id", "group_id") REFERENCES "device"("id", "group_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_task_device_lease_instance_device_fk" FOREIGN KEY ("instance_id", "device_id") REFERENCES "device_instance"("id", "device_id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX "execution_task_device_lease_active_unique" ON "execution_task_device_lease" ("device_id", coalesce("instance_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "execution_task_device_lease_task_index" ON "execution_task_device_lease" ("task_id", "released_at");
