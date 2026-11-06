ALTER TABLE behavior_chain
  ADD COLUMN remarks text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
UPDATE behavior_chain
SET remarks = array_fill(''::text, ARRAY[jsonb_array_length(parameters)])
WHERE jsonb_typeof(parameters) = 'array'
  AND jsonb_array_length(parameters) > 0;--> statement-breakpoint
ALTER TABLE operation_dispatch_step
  ADD COLUMN remark text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE operation_dispatch_step
  ADD CONSTRAINT operation_dispatch_step_remark_check
  CHECK (char_length(remark) <= 40 AND remark !~ '[\n\r]');--> statement-breakpoint
ALTER TABLE execution_task
  ADD COLUMN chain_name text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE execution_task
  ADD CONSTRAINT execution_task_chain_name_check
  CHECK (char_length(chain_name) <= 80);--> statement-breakpoint
ALTER TABLE execution_task_step
  ADD COLUMN remark text NOT NULL DEFAULT '',
  ADD COLUMN node_name text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE execution_task_step
  ADD CONSTRAINT execution_task_step_remark_check
  CHECK (char_length(remark) <= 40 AND remark !~ '[\n\r]');--> statement-breakpoint
ALTER TABLE execution_task_step
  ADD CONSTRAINT execution_task_step_node_name_check
  CHECK (char_length(node_name) <= 80);
