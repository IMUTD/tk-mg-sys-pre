ALTER TABLE "device" ADD COLUMN "assignee_user_id" uuid;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_assignee_user_id_app_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "device" d
SET "assignee_user_id" = (
  SELECT u.id
  FROM "user_group" ug
  JOIN "app_user" u ON u.id = ug.user_id AND u.enabled = true
  WHERE ug.group_id = d.group_id
  ORDER BY u.created_at
  LIMIT 1
)
WHERE d.external_id IS NOT NULL
  AND d.group_id <> '00000000-0000-4000-8000-000000000001'
  AND d.assignee_user_id IS NULL;
