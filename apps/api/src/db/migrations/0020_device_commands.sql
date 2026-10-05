CREATE TABLE "device_command" (
  "id" uuid PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "device_id" uuid NOT NULL,
  "instance_id" uuid,
  "group_id" uuid NOT NULL,
  "requester_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "parameters" jsonb NOT NULL,
  "timeout_ms" integer NOT NULL,
  "status" text NOT NULL,
  "provider_receipt" jsonb,
  "error_code" text,
  "result_reference" text,
  "result" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "finished_at" timestamptz
);--> statement-breakpoint
CREATE UNIQUE INDEX "device_command_group_key_unique" ON "device_command" ("group_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "device_command_device_created_index" ON "device_command" ("group_id", "device_id", "created_at");--> statement-breakpoint
CREATE TABLE "device_command_event" (
  "id" uuid PRIMARY KEY NOT NULL,
  "command_id" uuid NOT NULL REFERENCES "device_command"("id") ON DELETE restrict,
  "status" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "device_command_event_command_index" ON "device_command_event" ("command_id", "created_at");
