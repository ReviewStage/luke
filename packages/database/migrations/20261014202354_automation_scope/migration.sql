ALTER TABLE "automation" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "scope" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "repositories" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "target_kind" text DEFAULT 'new-agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "target_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "archive_successful" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "automation_org_scope_created" ON "automation" ("organization_id","scope","created_at");--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_target_agent_id_coding_agent_id_fkey" FOREIGN KEY ("target_agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;