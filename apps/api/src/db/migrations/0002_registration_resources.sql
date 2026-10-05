CREATE TYPE "public"."registration_resource_kind" AS ENUM('google-email', 'api-sms', 'microsoft-oauth', 'pop3');--> statement-breakpoint
CREATE TYPE "public"."registration_resource_status" AS ENUM('unverified', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "registration_resource" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "encrypted_secret" text NOT NULL,
  "fingerprint" text NOT NULL,
  "group_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identifier" text NOT NULL,
  "kind" "registration_resource_kind" NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "status" "registration_resource_status" DEFAULT 'unverified' NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "registration_resource_group_fingerprint_unique" UNIQUE("group_id", "fingerprint")
);--> statement-breakpoint
ALTER TABLE "registration_resource" ADD CONSTRAINT "registration_resource_group_id_access_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_resource_group_created_index" ON "registration_resource" USING btree ("group_id","created_at");
