CREATE TYPE "public"."device_status" AS ENUM('unknown', 'online', 'offline');--> statement-breakpoint
CREATE TABLE "device" (
  "bridge" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "group_id" uuid NOT NULL,
  "host" text NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "last_health_at" timestamp with time zone,
  "last_health_failure" text,
  "model" text NOT NULL,
  "name" text NOT NULL,
  "resource_count" integer DEFAULT 0 NOT NULL,
  "status" "device_status" DEFAULT 'unknown' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "version" text
);--> statement-breakpoint
CREATE TABLE "device_instance" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "device_id" uuid NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_index" integer NOT NULL,
  "label" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_instance_device_index_unique" UNIQUE("device_id", "instance_index")
);--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_instance" ADD CONSTRAINT "device_instance_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_group_created_index" ON "device" USING btree ("group_id", "created_at");--> statement-breakpoint
CREATE INDEX "device_instance_device_enabled_index" ON "device_instance" USING btree ("device_id", "enabled");
