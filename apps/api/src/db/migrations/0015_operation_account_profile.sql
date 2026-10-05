CREATE TYPE "public"."operation_account_app" AS ENUM('tiktok', 'youtube', 'facebook', 'instagram', 'twitter');--> statement-breakpoint
CREATE TYPE "public"."operation_account_backup_type" AS ENUM('local', 'private_cloud');--> statement-breakpoint
ALTER TABLE "operation_account"
  ADD COLUMN "app" "operation_account_app",
  ADD COLUMN "avatar" text DEFAULT '' NOT NULL,
  ADD COLUMN "backup_key" text DEFAULT '' NOT NULL,
  ADD COLUMN "backup_slot" text DEFAULT '' NOT NULL,
  ADD COLUMN "backup_type" "operation_account_backup_type",
  ADD COLUMN "deleted" boolean DEFAULT false NOT NULL,
  ADD COLUMN "deleted_at" timestamp with time zone,
  ADD COLUMN "device_id" uuid,
  ADD COLUMN "device_instance_id" uuid,
  ADD COLUMN "encrypted_totp" text DEFAULT '' NOT NULL,
  ADD COLUMN "encrypted_transfer_key" text DEFAULT '' NOT NULL,
  ADD COLUMN "extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "favorite" bigint,
  ADD COLUMN "follower" bigint,
  ADD COLUMN "following" bigint,
  ADD COLUMN "online" boolean DEFAULT false NOT NULL,
  ADD COLUMN "platform_uid" text DEFAULT '' NOT NULL,
  ADD COLUMN "proxy_id" uuid,
  ADD COLUMN "region" text DEFAULT '' NOT NULL,
  ADD COLUMN "transferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_account" ADD CONSTRAINT "operation_account_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_account" ADD CONSTRAINT "operation_account_device_instance_id_device_instance_id_fk" FOREIGN KEY ("device_instance_id") REFERENCES "public"."device_instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_account" ADD CONSTRAINT "operation_account_proxy_id_operation_proxy_id_fk" FOREIGN KEY ("proxy_id") REFERENCES "public"."operation_proxy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_account_app_index" ON "operation_account" USING btree ("group_id", "app");--> statement-breakpoint
CREATE INDEX "operation_account_deleted_at_index" ON "operation_account" USING btree ("deleted", "deleted_at");--> statement-breakpoint
CREATE INDEX "operation_account_device_instance_index" ON "operation_account" USING btree ("device_id", "device_instance_id");--> statement-breakpoint
CREATE INDEX "operation_account_group_active_index" ON "operation_account" USING btree ("group_id", "deleted", "created_at");--> statement-breakpoint
CREATE INDEX "operation_account_platform_uid_index" ON "operation_account" USING btree ("group_id", "platform_uid");--> statement-breakpoint
CREATE INDEX "operation_account_proxy_index" ON "operation_account" USING btree ("proxy_id");--> statement-breakpoint
COMMENT ON TABLE "operation_account" IS '运营账号库：机位备份下来的社交账号，按 access_group 隔离，删除先进回收站';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."id" IS '主键 UUID';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."group_id" IS '所属访问分组，对应原站 user_id 数据范围';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."name" IS '展示名，可默认等于用户名或 UID';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."identifier" IS '平台登录名 / unique_id，组内唯一';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."platform_uid" IS '平台数字 ID';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."encrypted_secret" IS '平台密码密文，API 不回说明文';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."encrypted_totp" IS '2FA 密钥密文，空表示未开';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."encrypted_transfer_key" IS '转移码密文';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."app" IS '来源应用：tiktok / youtube / facebook / instagram / twitter';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."tags" IS '业务分组与多标签，约定「收藏」表示已收藏';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."status" IS 'ready 正常 / suspended 暂停 / disabled 封号';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."online" IS '绑定机位是否在线，由设备健康或绑定时回写';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."transferred" IS '是否已经转出';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."follower" IS '粉丝数，无平台同步时允许空';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."following" IS '关注数';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."favorite" IS '获赞或收藏数';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."avatar" IS '头像地址';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."region" IS '账号归属地';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."extra" IS '签名、最近作品、最近任务等运行时数据';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."device_id" IS '备份来源盒子';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."device_instance_id" IS '备份来源机位';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."proxy_id" IS '绑定出口代理，代理删除后置空';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."backup_type" IS 'local 本地 / private_cloud 私有云';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."backup_key" IS '备份包在存储里的键';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."backup_slot" IS '备份插槽名';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."deleted" IS '是否在回收站';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."deleted_at" IS '进回收站时间';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."note" IS '备注';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."created_at" IS '创建或备份时间';--> statement-breakpoint
COMMENT ON COLUMN "operation_account"."updated_at" IS '资料最近更新时间';
