-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "repositories" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "target_kind" text DEFAULT 'new-agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "target_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "archive_successful" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_org_scope_created" ON "automation" ("organization_id","scope","created_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "automation" ADD CONSTRAINT "automation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "automation" ADD CONSTRAINT "automation_target_agent_id_coding_agent_id_fkey" FOREIGN KEY ("target_agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
