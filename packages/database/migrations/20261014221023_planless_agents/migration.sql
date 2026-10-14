-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
ALTER TABLE "coding_agent" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN IF NOT EXISTS "automation_id" uuid;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN IF NOT EXISTS "repositories" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
ALTER TABLE "coding_agent" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coding_agent_org_created" ON "coding_agent" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_item_org_updated" ON "inbox_item" ("organization_id","updated_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "coding_agent" ADD CONSTRAINT "coding_agent_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "coding_agent" ADD CONSTRAINT "coding_agent_automation_id_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;