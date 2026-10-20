CREATE TABLE IF NOT EXISTS "workspace_token_repository" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"repository" text NOT NULL,
	"added_by_user_id" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_token_repository_organization_repository" ON "workspace_token_repository" ("organization_id",lower("repository"));
--> statement-breakpoint
ALTER TABLE "workspace_token_repository" DROP CONSTRAINT IF EXISTS "workspace_token_repository_organization_id_organization_id_fkey";
--> statement-breakpoint
ALTER TABLE "workspace_token_repository" ADD CONSTRAINT "workspace_token_repository_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workspace_token_repository" DROP CONSTRAINT IF EXISTS "workspace_token_repository_added_by_user_id_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "workspace_token_repository" ADD CONSTRAINT "workspace_token_repository_added_by_user_id_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "user"("id") ON DELETE CASCADE;
