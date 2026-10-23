-- Expand step of dropping coding_agent.persona_name: the module no longer declares it, and nothing deployed since #4738 reads or writes it.
-- Note that the column itself stays one deployment longer, because a build migrates while the deployment before it still serves and Drizzle names every declared column in an insert.
-- The chat's revision trigger is made again without it, since a trigger that names a column is what a later DROP COLUMN would refuse over.
DROP TRIGGER IF EXISTS "workspace_chat_revise_agent" ON "coding_agent";
--> statement-breakpoint
CREATE TRIGGER "workspace_chat_revise_agent" AFTER UPDATE OF "title", "model", "task_id" ON "coding_agent" FOR EACH ROW WHEN (NEW."title" IS DISTINCT FROM OLD."title" OR NEW."model" IS DISTINCT FROM OLD."model" OR NEW."task_id" IS DISTINCT FROM OLD."task_id") EXECUTE FUNCTION "workspace_chat_revise_agent"();
