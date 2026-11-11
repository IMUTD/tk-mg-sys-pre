ALTER TABLE operation_dispatch_item
  DROP CONSTRAINT operation_dispatch_item_account_id_fkey;
--> statement-breakpoint
ALTER TABLE operation_dispatch_item
  ADD CONSTRAINT operation_dispatch_item_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES operation_account(id) ON DELETE SET NULL;
--> statement-breakpoint
COMMENT ON COLUMN operation_dispatch_item.account_id IS '派工时的账号。账号从回收站永久删除后置空，派工记录保留。';
