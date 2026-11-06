CREATE TABLE presence_leader (
  id smallint PRIMARY KEY CHECK (id = 1),
  holder text NOT NULL DEFAULT '',
  leased_until timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO presence_leader (id, holder, leased_until)
VALUES (1, '', now());

CREATE INDEX device_online_external_idx
  ON device (external_id)
  WHERE status = 'online' AND external_id IS NOT NULL;
