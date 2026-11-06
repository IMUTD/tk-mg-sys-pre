ALTER TABLE operation_dispatch
  ADD COLUMN repeat_plan jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE operation_dispatch
  ADD CONSTRAINT operation_dispatch_repeat_plan_array CHECK (jsonb_typeof(repeat_plan) = 'array');
