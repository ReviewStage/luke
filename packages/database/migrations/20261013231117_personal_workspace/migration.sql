CREATE TABLE "personal_workspace" (
	"user_id" text PRIMARY KEY,
	"organization_id" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_workspace" ADD CONSTRAINT "personal_workspace_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "personal_workspace" ADD CONSTRAINT "personal_workspace_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;