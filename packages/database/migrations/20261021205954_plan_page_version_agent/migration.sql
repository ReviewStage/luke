ALTER TABLE "plan_page_version" ADD COLUMN IF NOT EXISTS "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_page_version" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_page_version_agent" ON "plan_page_version" ("agent_id");--> statement-breakpoint
ALTER TABLE "plan_page_version" DROP CONSTRAINT IF EXISTS "plan_page_version_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "plan_page_version" ADD CONSTRAINT "plan_page_version_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Every row standing has its task, so the check holds of them all; agent_id is
-- left for new versions to fill, with no backfill from shown_by.
ALTER TABLE "plan_page_version" DROP CONSTRAINT IF EXISTS "plan_page_version_owner";--> statement-breakpoint
ALTER TABLE "plan_page_version" ADD CONSTRAINT "plan_page_version_owner" CHECK ("task_id" is not null or "agent_id" is not null);
