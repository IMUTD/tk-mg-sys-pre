ALTER TABLE "behavior_chain" ADD COLUMN "guards" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "execution_task" DROP CONSTRAINT "execution_task_status_check";
--> statement-breakpoint
ALTER TABLE "execution_task" ADD CONSTRAINT "execution_task_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'dispatching'::text, 'running'::text, 'cancel_requested'::text, 'cancelled'::text, 'retry_waiting'::text, 'succeeded'::text, 'failed'::text, 'timed_out'::text, 'needs_reconciliation'::text, 'ood'::text]));
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "role" text DEFAULT 'native' NOT NULL;
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "phase" text DEFAULT 'skill' NOT NULL;
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "guards" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "guard_code" text;
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "guard_index" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD COLUMN "parent_step_id" uuid;
--> statement-breakpoint
ALTER TABLE "execution_task_step" DROP CONSTRAINT "execution_task_step_status_check";
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD CONSTRAINT "execution_task_step_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'claimed'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'timed_out'::text, 'cancelled'::text, 'skipped'::text, 'held'::text]));
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD CONSTRAINT "execution_task_step_role_check" CHECK (role = ANY (ARRAY['native'::text, 'ood'::text]));
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD CONSTRAINT "execution_task_step_phase_check" CHECK (phase = ANY (ARRAY['skill'::text, 'guard'::text]));
--> statement-breakpoint
ALTER TABLE "execution_task_step" ADD CONSTRAINT "execution_task_step_parent_fk" FOREIGN KEY ("parent_step_id") REFERENCES "execution_task_step"("id") ON DELETE restrict ON UPDATE no action;
