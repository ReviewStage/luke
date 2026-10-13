ALTER TABLE "plan" DROP COLUMN "repository_owner";--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "repository_name";--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "repository_branch";--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "repository_commit";--> statement-breakpoint
CREATE TABLE "plan_command" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"command" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
ALTER TABLE "plan_command" ADD CONSTRAINT "plan_command_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;
