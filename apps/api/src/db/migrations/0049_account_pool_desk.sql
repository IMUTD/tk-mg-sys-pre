ALTER TABLE operation_account_pool DROP CONSTRAINT operation_account_pool_size_check;
--> statement-breakpoint
ALTER TABLE operation_account_pool ADD CONSTRAINT operation_account_pool_size_check
  CHECK (member_count BETWEEN 0 AND 3000);
--> statement-breakpoint
ALTER TABLE operation_account_pool DROP CONSTRAINT operation_account_pool_key_check;
--> statement-breakpoint
ALTER TABLE operation_account_pool ADD CONSTRAINT operation_account_pool_key_check
  CHECK (length(trim(key)) BETWEEN 1 AND 400 AND position('+' in key) = 0);
--> statement-breakpoint
COMMENT ON COLUMN operation_account_pool.filter_condition IS
  '旧池保存来源筛选。新池保存 kind=desk 的账号管理筛选，成员按这些条件实时计算。';
