CREATE TABLE "box_remark" (
  "administrator_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE cascade,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "box_remark_admin_name_unique" UNIQUE("administrator_id","name")
);
--> statement-breakpoint
CREATE TABLE "box_group" (
  "administrator_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE cascade,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "box_group_admin_name_unique" UNIQUE("administrator_id","name")
);
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "remark_id" uuid;
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "box_group_id" uuid;
--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_remark_id_box_remark_id_fk" FOREIGN KEY ("remark_id") REFERENCES "box_remark"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_box_group_id_box_group_id_fk" FOREIGN KEY ("box_group_id") REFERENCES "box_group"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "box_remark_administrator_index" ON "box_remark" USING btree ("administrator_id");
--> statement-breakpoint
CREATE INDEX "box_group_administrator_index" ON "box_group" USING btree ("administrator_id");
