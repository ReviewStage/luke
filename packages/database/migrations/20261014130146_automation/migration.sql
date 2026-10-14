CREATE TABLE "automation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"paused_reason" text,
	"trigger_kind" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"guards" jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"webhook_secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"automation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"firing" jsonb NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"coding_agent_id" uuid,
	"fired_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "automation_user_created" ON "automation" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_next_run" ON "automation" ("next_run_at") WHERE "next_run_at" is not null;--> statement-breakpoint
CREATE INDEX "automation_trigger_plan" ON "automation" ("trigger_kind","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_dedupe" ON "automation_run" ("automation_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "automation_run_automation_fired" ON "automation_run" ("automation_id","fired_at");--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_coding_agent_id_coding_agent_id_fkey" FOREIGN KEY ("coding_agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;