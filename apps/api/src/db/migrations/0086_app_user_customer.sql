-- 客户方：平台方在“客户管理”里创建的管理员。
-- 客户方可以登录初始化工具建盒子管理员（一级用户），并能看到名下盒子管理员的数据。
-- 现有账号都不是客户方，不需要回填。
ALTER TABLE app_user
  ADD COLUMN is_customer boolean NOT NULL DEFAULT false;--> statement-breakpoint

ALTER TABLE app_user
  ADD CONSTRAINT app_user_customer_shape CHECK (
    NOT is_customer
    OR (role = 'administrator' AND NOT is_platform AND provisioned_by <> 'init-tool')
  );
