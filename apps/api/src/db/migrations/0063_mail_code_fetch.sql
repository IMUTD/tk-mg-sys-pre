CREATE TABLE mail_code_fetch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES execution_task(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES execution_task_step(id) ON DELETE CASCADE,
  account_id uuid REFERENCES operation_account(id) ON DELETE SET NULL,
  status text NOT NULL,
  error_code text NOT NULL DEFAULT '',
  code text NOT NULL DEFAULT '',
  timeout_seconds integer NOT NULL,
  interval_seconds integer NOT NULL,
  lookback_seconds integer NOT NULL,
  folder text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT mail_code_fetch_status_check CHECK (status IN ('waiting', 'succeeded', 'failed')),
  CONSTRAINT mail_code_fetch_seconds_check CHECK (
    timeout_seconds BETWEEN 1 AND 1800
    AND interval_seconds BETWEEN 1 AND 60
    AND lookback_seconds BETWEEN 0 AND 300
    AND folder <> ''
  ),
  CONSTRAINT mail_code_fetch_result_check CHECK (
    (status = 'waiting' AND code = '' AND error_code = '' AND finished_at IS NULL)
    OR (status = 'succeeded' AND code ~ '^[0-9]{6}$' AND error_code = '' AND finished_at IS NOT NULL)
    OR (status = 'failed' AND code = '' AND error_code <> '' AND finished_at IS NOT NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX mail_code_fetch_step_waiting_unique
  ON mail_code_fetch (step_id) WHERE status = 'waiting';--> statement-breakpoint
CREATE INDEX mail_code_fetch_task_created_index ON mail_code_fetch (task_id, created_at);--> statement-breakpoint
CREATE INDEX mail_code_fetch_group_created_index ON mail_code_fetch (group_id, created_at);
