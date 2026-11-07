ALTER TABLE mall_order
  ADD COLUMN shipped_at timestamp with time zone,
  ADD COLUMN shipped_by uuid REFERENCES app_user(id) ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE mall_order
  ADD CONSTRAINT mall_order_shipped_check CHECK ((status = 'shipped') = (shipped_at IS NOT NULL));--> statement-breakpoint

-- 记录每一次归属变更。不给 entity_id 加外键：账号或代理之后被删除，记录仍要保留。
CREATE TABLE mall_resource_transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  entity_id uuid NOT NULL,
  display_name text NOT NULL,
  source_group_id uuid REFERENCES access_group(id) ON DELETE SET NULL,
  target_group_id uuid REFERENCES access_group(id) ON DELETE SET NULL,
  order_id uuid REFERENCES mall_order(id) ON DELETE RESTRICT,
  moved_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mall_resource_transfer_kind_check CHECK (kind IN ('account', 'proxy'))
);--> statement-breakpoint

CREATE UNIQUE INDEX mall_resource_transfer_order_entity_unique
  ON mall_resource_transfer (order_id, entity_id) WHERE order_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX mall_resource_transfer_created_index
  ON mall_resource_transfer (created_at DESC, id DESC);
--> statement-breakpoint

-- 下面两个触发器防的是同一件事：写入方先查归属再写，查完之后账号或代理被转走。
-- 外键只看 id，等转移提交后仍然放行，所以要在写入时带锁再查一次归属。
-- 只在值变化时检查，历史上留下的跨分组绑定不会让普通编辑报错。
CREATE FUNCTION operation_account_proxy_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM operation_proxy
  WHERE id = NEW.proxy_id AND group_id = NEW.group_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proxy does not belong to the account group';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER operation_account_proxy_owner_insert
  BEFORE INSERT ON operation_account
  FOR EACH ROW WHEN (NEW.proxy_id IS NOT NULL)
  EXECUTE FUNCTION operation_account_proxy_owner_guard();--> statement-breakpoint
CREATE TRIGGER operation_account_proxy_owner_update
  BEFORE UPDATE OF proxy_id ON operation_account
  FOR EACH ROW WHEN (NEW.proxy_id IS NOT NULL AND NEW.proxy_id IS DISTINCT FROM OLD.proxy_id)
  EXECUTE FUNCTION operation_account_proxy_owner_guard();--> statement-breakpoint

CREATE FUNCTION operation_dispatch_item_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS NOT NULL THEN
    PERFORM 1 FROM operation_account
    WHERE id = NEW.account_id AND group_id = NEW.group_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account does not belong to the dispatch group';
    END IF;
  END IF;
  IF NEW.proxy_id IS NOT NULL THEN
    PERFORM 1 FROM operation_proxy
    WHERE id = NEW.proxy_id AND group_id = NEW.group_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'proxy does not belong to the dispatch group';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER operation_dispatch_item_owner_insert
  BEFORE INSERT ON operation_dispatch_item
  FOR EACH ROW EXECUTE FUNCTION operation_dispatch_item_owner_guard();
