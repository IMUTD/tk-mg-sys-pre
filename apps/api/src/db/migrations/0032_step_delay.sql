ALTER TABLE "behavior_chain" ADD COLUMN "delays" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "after_ms" integer DEFAULT 0 NOT NULL;
