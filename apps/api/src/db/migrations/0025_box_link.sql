ALTER TABLE "device" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "box_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "firmware" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "memory" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "memory_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "cpu_temp" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "cpu_load" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "cpu_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "disk" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "disk_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "agent_version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "api_version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "device_external_id_unique" ON "device" ("external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "api_port" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "rpa_port" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "width" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "height" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "container_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE "device_agent" (
  "device_id" uuid PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "agent_version" text DEFAULT '' NOT NULL,
  "registered_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "device_agent" ADD CONSTRAINT "device_agent_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "device_watch" (
  "device_id" uuid NOT NULL,
  "instance_index" integer NOT NULL,
  "user_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "device_watch_pkey" PRIMARY KEY("device_id","instance_index","user_id"),
  CONSTRAINT "device_watch_index_check" CHECK ("instance_index" between 1 and 5)
);--> statement-breakpoint
ALTER TABLE "device_watch" ADD CONSTRAINT "device_watch_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_watch" ADD CONSTRAINT "device_watch_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_watch_device_expires_idx" ON "device_watch" USING btree ("device_id","expires_at");--> statement-breakpoint
CREATE TABLE "init_session" (
  "token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "init_session" ADD CONSTRAINT "init_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "operation_log" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "group_id" uuid NOT NULL,
  "actor_id" uuid,
  "device_id" uuid,
  "level" text NOT NULL,
  "text" text NOT NULL,
  "dedup_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "operation_log_level_check" CHECK ("level" in ('info', 'ok', 'error'))
);--> statement-breakpoint
ALTER TABLE "operation_log" ADD CONSTRAINT "operation_log_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_log" ADD CONSTRAINT "operation_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_log_group_id_idx" ON "operation_log" USING btree ("group_id","id");--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "instance_id" uuid;--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD CONSTRAINT "execution_task_step_instance_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."device_instance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_task_claim_idx" ON "execution_task" USING btree ("device_id","status","created_at") WHERE "status" in ('queued', 'dispatching');--> statement-breakpoint
INSERT INTO "access_group" ("id", "name") VALUES ('00000000-0000-4000-8000-000000000001', '未分配') ON CONFLICT ("id") DO NOTHING;
