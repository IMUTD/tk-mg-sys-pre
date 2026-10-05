CREATE TABLE "behavior_chain" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "administrator_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "name" text NOT NULL,
  "origin" text NOT NULL,
  "executor_key" text DEFAULT 'box-agent' NOT NULL,
  "parameters" jsonb NOT NULL,
  "param_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_tested_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "behavior_chain_origin_check" CHECK ("origin" = ANY (ARRAY['rpa'::text, 'ai'::text]))
);
--> statement-breakpoint
ALTER TABLE "behavior_chain" ADD CONSTRAINT "behavior_chain_group_fk" FOREIGN KEY ("group_id") REFERENCES "access_group"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "behavior_chain" ADD CONSTRAINT "behavior_chain_administrator_fk" FOREIGN KEY ("administrator_id") REFERENCES "app_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "behavior_chain" ADD CONSTRAINT "behavior_chain_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "behavior_chain_administrator_updated_index" ON "behavior_chain" USING btree ("administrator_id","updated_at");
--> statement-breakpoint
CREATE INDEX "behavior_chain_group_created_index" ON "behavior_chain" USING btree ("group_id","created_at");
