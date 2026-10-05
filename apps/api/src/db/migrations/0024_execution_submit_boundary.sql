ALTER TABLE "execution_task_step" ADD COLUMN "submit_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "execution_task_run" DROP CONSTRAINT "execution_task_run_status_check";
--> statement-breakpoint
ALTER TABLE "execution_task_run" ADD CONSTRAINT "execution_task_run_status_check"
  CHECK ("status" IN ('claimed','running','succeeded','failed','timed_out','cancelled','recovered','needs_reconciliation'));
