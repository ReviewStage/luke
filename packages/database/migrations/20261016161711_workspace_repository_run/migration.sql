CREATE TABLE IF NOT EXISTS "workspace_repository_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"repository" text NOT NULL,
	"setup_command" text,
	"run_command" text,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_repository_run_organization_id_repository_unique" ON "workspace_repository_run" ("organization_id","repository");--> statement-breakpoint
ALTER TABLE "workspace_repository_run" DROP CONSTRAINT IF EXISTS "workspace_repository_run_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "workspace_repository_run" ADD CONSTRAINT "workspace_repository_run_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_repository_run" DROP CONSTRAINT IF EXISTS "workspace_repository_run_updated_by_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "workspace_repository_run" ADD CONSTRAINT "workspace_repository_run_updated_by_user_id_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
