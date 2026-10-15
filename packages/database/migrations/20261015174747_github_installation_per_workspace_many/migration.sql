ALTER TABLE "github_installation" DROP CONSTRAINT IF EXISTS "github_installation_installation_id_key";--> statement-breakpoint
ALTER TABLE "github_installation" DROP CONSTRAINT IF EXISTS "github_installation_pkey";--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_pkey" PRIMARY KEY ("installation_id");--> statement-breakpoint
ALTER TABLE "github_installation" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_installation_organization_id_idx" ON "github_installation" ("organization_id");
