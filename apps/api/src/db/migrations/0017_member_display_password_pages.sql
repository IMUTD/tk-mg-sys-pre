ALTER TABLE "app_user" ADD COLUMN "display_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "encrypted_password" text;--> statement-breakpoint
UPDATE "app_user" SET "display_name" = '管理员' WHERE "role" = 'administrator' AND "display_name" = '';--> statement-breakpoint
CREATE TABLE "user_page_permission" (
  "user_id" uuid NOT NULL,
  "page_key" text NOT NULL,
  "can_view" boolean NOT NULL,
  "can_delete" boolean NOT NULL,
  CONSTRAINT "user_page_permission_user_id_page_key_pk" PRIMARY KEY("user_id","page_key")
);--> statement-breakpoint
ALTER TABLE "user_page_permission" ADD CONSTRAINT "user_page_permission_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
COMMENT ON COLUMN "app_user"."display_name" IS '展示名，新建时从动漫/影视/动物/明星名里随机';--> statement-breakpoint
COMMENT ON COLUMN "app_user"."encrypted_password" IS '供管理员查看和复制的登录密码密文，可空（引导管理员可能没有）';--> statement-breakpoint
COMMENT ON TABLE "user_page_permission" IS '成员最终页面权限，新建时从角色默认矩阵复制，之后由管理员微调';--> statement-breakpoint
COMMENT ON COLUMN "user_page_permission"."user_id" IS '成员';--> statement-breakpoint
COMMENT ON COLUMN "user_page_permission"."page_key" IS '前端路由';--> statement-breakpoint
COMMENT ON COLUMN "user_page_permission"."can_view" IS '能否看到并进入该页面';--> statement-breakpoint
COMMENT ON COLUMN "user_page_permission"."can_delete" IS '该页删除按钮与删除接口';
