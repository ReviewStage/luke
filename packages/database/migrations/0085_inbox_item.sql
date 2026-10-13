CREATE TABLE "inbox_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"key" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"options" jsonb,
	"recommended" text,
	"needs_reply" boolean NOT NULL,
	"status" text NOT NULL,
	"answer" jsonb,
	"answer_key" text,
	"closed_reason" text,
	"posted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_agent_id_coding_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."coding_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_item_agent_key" ON "inbox_item" USING btree ("agent_id","key");--> statement-breakpoint
CREATE INDEX "inbox_item_plan_updated" ON "inbox_item" USING btree ("plan_id","updated_at");
