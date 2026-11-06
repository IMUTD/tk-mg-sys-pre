CREATE TABLE operation_dispatch_stage (
  dispatch_id uuid NOT NULL REFERENCES operation_dispatch(id) ON DELETE CASCADE,
  stage_position integer NOT NULL,
  auto_retry boolean NOT NULL DEFAULT false,
  auto_retry_limit smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (dispatch_id, stage_position),
  CONSTRAINT operation_dispatch_stage_position_check
    CHECK (stage_position >= 0 AND stage_position < 20),
  CONSTRAINT operation_dispatch_stage_limit_check
    CHECK (
      (auto_retry = false AND auto_retry_limit = 0)
      OR (auto_retry = true AND auto_retry_limit BETWEEN 1 AND 9)
    )
);--> statement-breakpoint
ALTER TABLE operation_dispatch_step
  ADD COLUMN refresh_external boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE operation_dispatch_step
  ADD CONSTRAINT operation_dispatch_step_refresh_check
  CHECK (refresh_external = false OR skill = 'IndependentV5S5');--> statement-breakpoint
ALTER TABLE execution_task
  ADD COLUMN auto_retry boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_retry_limit smallint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE execution_task
  ADD CONSTRAINT execution_task_auto_retry_limit_check
  CHECK (auto_retry_limit BETWEEN 0 AND 9);--> statement-breakpoint
ALTER TABLE operation_stage_replay
  ADD COLUMN origin text NOT NULL DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE operation_stage_replay
  ADD CONSTRAINT operation_stage_replay_origin_check
  CHECK (origin IN ('manual', 'auto'));
