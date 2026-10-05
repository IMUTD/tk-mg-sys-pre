CREATE TABLE "storage_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_credentials" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "storage_setting_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE restrict ON UPDATE no action
);
