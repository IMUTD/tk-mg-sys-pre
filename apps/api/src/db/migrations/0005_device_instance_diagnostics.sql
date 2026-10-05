ALTER TABLE "device" DROP COLUMN "last_playback_diagnostic";
--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "status" "device_status" DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "last_health_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "last_health_failure" text;
--> statement-breakpoint
ALTER TABLE "device_instance" ADD COLUMN "last_playback_diagnostic" text;
