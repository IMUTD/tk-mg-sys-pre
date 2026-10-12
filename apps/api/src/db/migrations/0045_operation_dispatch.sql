ALTER TABLE execution_task
  ADD COLUMN account_id uuid REFERENCES operation_account(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX execution_task_account_index ON execution_task (account_id);--> statement-breakpoint
CREATE TABLE operation_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  chain_id uuid NOT NULL REFERENCES behavior_chain(id) ON DELETE RESTRICT,
  name text NOT NULL,
  selection jsonb NOT NULL,
  status text NOT NULL DEFAULT 'incomplete',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operation_dispatch_status_check CHECK (status IN ('incomplete', 'ready', 'started')),
  CONSTRAINT operation_dispatch_selection_object CHECK (jsonb_typeof(selection) = 'object')
);--> statement-breakpoint
CREATE INDEX operation_dispatch_group_created_index ON operation_dispatch (group_id, created_at);--> statement-breakpoint
CREATE TABLE operation_dispatch_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES operation_dispatch(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES operation_account(id) ON DELETE RESTRICT,
  device_id uuid REFERENCES device(id) ON DELETE SET NULL,
  instance_index integer,
  instance_id uuid REFERENCES device_instance(id) ON DELETE SET NULL,
  proxy_id uuid REFERENCES operation_proxy(id) ON DELETE SET NULL,
  missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_task_id uuid,
  status text NOT NULL DEFAULT 'incomplete',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operation_dispatch_item_status_check CHECK (status IN ('incomplete', 'ready', 'started')),
  CONSTRAINT operation_dispatch_item_index_check CHECK (instance_index IS NULL OR (instance_index BETWEEN 1 AND 5)),
  CONSTRAINT operation_dispatch_item_missing_array CHECK (jsonb_typeof(missing) = 'array')
);--> statement-breakpoint
CREATE INDEX operation_dispatch_item_dispatch_index ON operation_dispatch_item (dispatch_id);--> statement-breakpoint
CREATE TABLE operation_dispatch_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES operation_dispatch_item(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  skill text NOT NULL,
  sources jsonb NOT NULL,
  scopes jsonb NOT NULL,
  parameters jsonb NOT NULL,
  fill_status text NOT NULL,
  missing_keys text[] NOT NULL DEFAULT '{}',
  text_resource_id uuid REFERENCES operation_resource(id) ON DELETE SET NULL,
  guards jsonb NOT NULL DEFAULT '[]'::jsonb,
  after_ms integer NOT NULL DEFAULT 0,
  CONSTRAINT operation_dispatch_step_sequence_unique UNIQUE (item_id, sequence),
  CONSTRAINT operation_dispatch_step_fill_check CHECK (fill_status IN ('complete', 'incomplete'))
);--> statement-breakpoint
CREATE INDEX operation_dispatch_step_item_index ON operation_dispatch_step (item_id, sequence);
