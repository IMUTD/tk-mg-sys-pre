ALTER TABLE operation_proxy
  ADD COLUMN display_id bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN configuration jsonb,
  ADD COLUMN revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN check_result jsonb,
  ADD COLUMN probe_token uuid,
  ADD COLUMN probe_started_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX operation_proxy_display_id_unique ON operation_proxy(display_id);
CREATE UNIQUE INDEX operation_proxy_group_id_unique ON operation_proxy(group_id, id);
ALTER TABLE operation_proxy
  ADD CONSTRAINT operation_proxy_revision_positive CHECK (revision > 0),
  ADD CONSTRAINT operation_proxy_configuration_object
    CHECK (configuration IS NULL OR jsonb_typeof(configuration) = 'object'),
  ADD CONSTRAINT operation_proxy_result_object
    CHECK (check_result IS NULL OR jsonb_typeof(check_result) = 'object');
--> statement-breakpoint
CREATE TABLE operation_proxy_accelerator (
  group_id uuid NOT NULL,
  proxy_id uuid NOT NULL,
  accelerator_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0 AND position <= 10),
  PRIMARY KEY (proxy_id, accelerator_id),
  CONSTRAINT operation_proxy_accelerator_position_unique UNIQUE (proxy_id, position),
  CHECK (proxy_id <> accelerator_id),
  CONSTRAINT operation_proxy_accelerator_owner_fk FOREIGN KEY (group_id, proxy_id)
    REFERENCES operation_proxy(group_id, id) ON DELETE CASCADE,
  CONSTRAINT operation_proxy_accelerator_target_fk FOREIGN KEY (group_id, accelerator_id)
    REFERENCES operation_proxy(group_id, id) ON DELETE RESTRICT
);
CREATE INDEX operation_proxy_accelerator_target_index ON operation_proxy_accelerator(accelerator_id);
