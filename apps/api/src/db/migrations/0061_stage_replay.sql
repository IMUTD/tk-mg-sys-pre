ALTER TABLE execution_task
  ADD COLUMN queue_priority smallint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE execution_task
  ADD CONSTRAINT execution_task_queue_priority_check
  CHECK (queue_priority IN (0, 1));--> statement-breakpoint
CREATE UNIQUE INDEX execution_task_active_stage_unique
  ON execution_task (dispatch_item_id, stage_position, repeat_index)
  WHERE dispatch_item_id IS NOT NULL
    AND status IN ('queued', 'dispatching', 'running', 'ood');--> statement-breakpoint
CREATE TABLE operation_stage_replay (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  dispatch_id uuid NOT NULL REFERENCES operation_dispatch(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES operation_dispatch_item(id) ON DELETE CASCADE,
  source_task_id uuid NOT NULL REFERENCES execution_task(id) ON DELETE RESTRICT,
  replay_task_id uuid NOT NULL REFERENCES execution_task(id) ON DELETE RESTRICT,
  stage_position integer NOT NULL,
  repeat_index integer NOT NULL,
  choices jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operation_stage_replay_choices_array CHECK (jsonb_typeof(choices) = 'array'),
  CONSTRAINT operation_stage_replay_task_unique UNIQUE (replay_task_id)
);--> statement-breakpoint
CREATE INDEX operation_stage_replay_item_index
  ON operation_stage_replay (item_id, stage_position, repeat_index, created_at);
