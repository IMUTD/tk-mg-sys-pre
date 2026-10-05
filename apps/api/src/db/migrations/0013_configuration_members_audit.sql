ALTER TABLE "app_user" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "system_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "system_setting_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "audit_event_actor_created_index" ON "audit_event" USING btree ("actor_id", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_event_action_created_index" ON "audit_event" USING btree ("action", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_event_group_created_index" ON "audit_event" USING btree (("metadata" ->> 'groupId'), "created_at");
