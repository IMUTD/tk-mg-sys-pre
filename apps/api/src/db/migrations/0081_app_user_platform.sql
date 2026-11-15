-- 平台方（超级用户）改为显式标记，不再从 provisioned_by 推断。
-- 回填保持现有行为：现在被视为平台方的就是非初始化工具创建的管理员。
-- 之后新建的管理员默认不是平台方，需由部署脚本显式标记。
ALTER TABLE app_user
  ADD COLUMN is_platform boolean NOT NULL DEFAULT false;--> statement-breakpoint

UPDATE app_user
  SET is_platform = true
  WHERE role = 'administrator' AND provisioned_by <> 'init-tool';--> statement-breakpoint

ALTER TABLE app_user
  ADD CONSTRAINT app_user_platform_shape CHECK (
    NOT is_platform OR (role = 'administrator' AND provisioned_by <> 'init-tool')
  );
