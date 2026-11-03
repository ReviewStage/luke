CREATE TABLE "slack_installation" (
	"organization_id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"linked_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_member" (
	"organization_id" text,
	"user_id" text,
	"slack_user_id" text,
	"looked_up_at" timestamp with time zone NOT NULL,
	CONSTRAINT "slack_member_pkey" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_linked_by_user_id_user_id_fkey" FOREIGN KEY ("linked_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "slack_member" ADD CONSTRAINT "slack_member_v9nbObT5MiRv_fkey" FOREIGN KEY ("organization_id") REFERENCES "slack_installation"("organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "slack_member" ADD CONSTRAINT "slack_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;