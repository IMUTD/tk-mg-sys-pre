UPDATE "operation_task_allocation" allocation SET "group_id" = task."group_id" FROM "operation_task" task WHERE allocation."task_id" = task."id" AND allocation."group_id" IS NULL;--> statement-breakpoint
ALTER TABLE "operation_task_allocation" ALTER COLUMN "group_id" SET NOT NULL;
