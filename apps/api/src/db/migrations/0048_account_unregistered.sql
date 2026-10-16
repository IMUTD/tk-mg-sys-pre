ALTER TYPE operation_account_status ADD VALUE IF NOT EXISTS 'unregistered';

DROP TABLE IF EXISTS registration_pool;

COMMENT ON TYPE operation_account_status IS 'ready 正常 / suspended 封号 / disabled 停用 / expired 过期 / hidden 不可见 / unregistered 未注册，只在注册池显示';
