ALTER TABLE "execution_task" DROP CONSTRAINT "execution_task_status_check";--> statement-breakpoint
ALTER TABLE "execution_task"
  ADD CONSTRAINT "execution_task_status_check"
  CHECK ("status" IN ('queued','dispatching','running','cancel_requested','cancelled','retry_waiting','succeeded','failed','timed_out','needs_reconciliation'));--> statement-breakpoint
ALTER TABLE "execution_task_event" DROP CONSTRAINT "execution_task_event_to_status_check";--> statement-breakpoint
ALTER TABLE "execution_task_event"
  ADD CONSTRAINT "execution_task_event_to_status_check"
  CHECK ("to_status" IN ('queued','dispatching','running','cancel_requested','cancelled','retry_waiting','succeeded','failed','timed_out','needs_reconciliation'));
