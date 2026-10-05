ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "password_plain" text DEFAULT '' NOT NULL;
