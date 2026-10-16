CREATE TABLE registration_pool (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  resource text NOT NULL,
  parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  tag text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '0',
  result text NOT NULL DEFAULT '0',
  recycle text NOT NULL DEFAULT '0',
  remark text NOT NULL DEFAULT '',
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_pool_status_check CHECK (status IN ('0', '1')),
  CONSTRAINT registration_pool_result_check CHECK (result IN ('0', '1')),
  CONSTRAINT registration_pool_recycle_check CHECK (recycle IN ('0', '1')),
  CONSTRAINT registration_pool_tag_check CHECK (position('+' in tag) = 0 AND char_length(tag) <= 40),
  CONSTRAINT registration_pool_parsed_object CHECK (jsonb_typeof(parsed) = 'object'),
  CONSTRAINT registration_pool_resource_check CHECK (char_length(btrim(resource)) BETWEEN 1 AND 2000)
);

CREATE INDEX registration_pool_group_created_index ON registration_pool (group_id, created_at DESC, id DESC);
CREATE INDEX registration_pool_group_tag_index ON registration_pool (group_id, tag);

COMMENT ON TABLE registration_pool IS '注册池。和账号表分开，保存云大师注册资源：资源原文、智能解析、分组、分配状态、结果和备注。';
