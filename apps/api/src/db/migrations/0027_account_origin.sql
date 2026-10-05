ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "provisioned_by" text DEFAULT 'sys' NOT NULL;--> statement-breakpoint
UPDATE "app_user" u
SET "provisioned_by" = 'init-tool'
WHERE u.role = 'operator'
  AND EXISTS (
    SELECT 1
    FROM "user_group" ug
    WHERE ug.user_id = u.id
      AND ug.group_id <> '00000000-0000-4000-8000-000000000001'
      AND (
        SELECT count(*)
        FROM "user_group" members
        WHERE members.group_id = ug.group_id
      ) = 1
  );--> statement-breakpoint
INSERT INTO "user_page_permission" ("user_id", "page_key", "can_view", "can_delete")
SELECT u.id, '/members', true, true
FROM "app_user" u
WHERE u.provisioned_by = 'init-tool'
ON CONFLICT ("user_id", "page_key") DO UPDATE
SET "can_view" = true, "can_delete" = true;
