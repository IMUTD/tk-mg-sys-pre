CREATE TABLE task_chain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  administrator_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_chain_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);--> statement-breakpoint
CREATE INDEX task_chain_admin_updated_index ON task_chain (administrator_id, updated_at DESC);--> statement-breakpoint
CREATE TABLE task_chain_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_chain_id uuid NOT NULL REFERENCES task_chain(id) ON DELETE CASCADE,
  position integer NOT NULL,
  chain_id uuid NOT NULL REFERENCES behavior_chain(id) ON DELETE RESTRICT,
  CONSTRAINT task_chain_item_position_unique UNIQUE (task_chain_id, position),
  CONSTRAINT task_chain_item_position_check CHECK (position >= 0 AND position < 20)
);--> statement-breakpoint
CREATE INDEX task_chain_item_chain_index ON task_chain_item (chain_id);--> statement-breakpoint
ALTER TABLE operation_dispatch ALTER COLUMN chain_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE operation_dispatch
  ADD COLUMN task_chain_id uuid REFERENCES task_chain(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE operation_dispatch
  ADD CONSTRAINT operation_dispatch_chain_xor CHECK (
    (chain_id IS NOT NULL AND task_chain_id IS NULL)
    OR (chain_id IS NULL AND task_chain_id IS NOT NULL)
  );--> statement-breakpoint
CREATE INDEX operation_dispatch_task_chain_index ON operation_dispatch (task_chain_id);--> statement-breakpoint
ALTER TABLE operation_dispatch_step
  ADD COLUMN stage_position integer NOT NULL DEFAULT 0,
  ADD COLUMN stage_name text NOT NULL DEFAULT '',
  ADD COLUMN repeat_index integer NOT NULL DEFAULT 0,
  ADD COLUMN repeat_count integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE operation_dispatch_step DROP CONSTRAINT operation_dispatch_step_sequence_unique;--> statement-breakpoint
ALTER TABLE operation_dispatch_step
  ADD CONSTRAINT operation_dispatch_step_sequence_unique UNIQUE (item_id, stage_position, repeat_index, sequence);--> statement-breakpoint
ALTER TABLE operation_dispatch_step
  ADD CONSTRAINT operation_dispatch_step_repeat_check CHECK (
    repeat_count BETWEEN 1 AND 99
    AND repeat_index >= 0
    AND repeat_index < repeat_count
    AND stage_position >= 0
  );--> statement-breakpoint
ALTER TABLE execution_task
  ADD COLUMN predecessor_task_id uuid REFERENCES execution_task(id) ON DELETE RESTRICT,
  ADD COLUMN dispatch_item_id uuid REFERENCES operation_dispatch_item(id) ON DELETE RESTRICT,
  ADD COLUMN task_chain_id uuid REFERENCES task_chain(id) ON DELETE RESTRICT,
  ADD COLUMN stage_position integer NOT NULL DEFAULT 0,
  ADD COLUMN stage_count integer NOT NULL DEFAULT 1,
  ADD COLUMN repeat_index integer NOT NULL DEFAULT 0,
  ADD COLUMN repeat_count integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE execution_task
  ADD CONSTRAINT execution_task_repeat_check CHECK (
    repeat_count BETWEEN 1 AND 99
    AND repeat_index >= 0
    AND repeat_index < repeat_count
    AND stage_count >= 1
    AND stage_position >= 0
    AND stage_position < stage_count
  );--> statement-breakpoint
CREATE INDEX execution_task_predecessor_index ON execution_task (predecessor_task_id);--> statement-breakpoint
CREATE INDEX execution_task_dispatch_item_stage_index ON execution_task (dispatch_item_id, stage_position, repeat_index);--> statement-breakpoint
CREATE INDEX execution_task_task_chain_index ON execution_task (task_chain_id);
