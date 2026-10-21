ALTER TABLE "plan_page_version" ADD COLUMN IF NOT EXISTS "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_page_version" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_page_version_agent" ON "plan_page_version" ("agent_id");--> statement-breakpoint
ALTER TABLE "plan_page_version" DROP CONSTRAINT IF EXISTS "plan_page_version_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "plan_page_version" ADD CONSTRAINT "plan_page_version_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Every row standing has its task, so the check holds of them all; agent_id is
-- left for new versions to fill, with no backfill from shown_by.
ALTER TABLE "plan_page_version" DROP CONSTRAINT IF EXISTS "plan_page_version_owner";--> statement-breakpoint
ALTER TABLE "plan_page_version" ADD CONSTRAINT "plan_page_version_owner" CHECK ("task_id" is not null or "agent_id" is not null);
--> statement-breakpoint
-- A page of a coding agent on no task has no owner but the agent, so it goes
-- with the agent however the agent goes: deleted itself, or by its account's,
-- its workspace's, or its conversation's deletion cascading into it. Without
-- this, clearing agent_id would leave a row the owner check refuses, and the
-- deletion would fail. A task's pages keep their versions, agent_id cleared.
CREATE OR REPLACE FUNCTION "plan_page_version_agent_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	DELETE FROM "plan_page_version" WHERE "agent_id" = OLD."id" AND "task_id" IS NULL;
	RETURN OLD;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "plan_page_version_agent_delete" ON "coding_agent";
--> statement-breakpoint
CREATE TRIGGER "plan_page_version_agent_delete" BEFORE DELETE ON "coding_agent" FOR EACH ROW EXECUTE FUNCTION "plan_page_version_agent_delete"();
