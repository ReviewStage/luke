-- Custom SQL migration file, put your code below! --
-- A member who leaves a workspace, or is removed from it, lets go of every task of that workspace assigned to them, in the statement that takes them out, so no task stays assigned to someone who can no longer read it, whichever write took them out.
CREATE OR REPLACE FUNCTION "task_assignee_leaves_with_member"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	UPDATE "task" SET "assignee_id" = NULL
	WHERE "organization_id" = OLD."organization_id" AND "assignee_id" = OLD."user_id";
	RETURN OLD;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "task_assignee_leaves_with_member" ON "member";
--> statement-breakpoint
CREATE TRIGGER "task_assignee_leaves_with_member" AFTER DELETE ON "member" FOR EACH ROW EXECUTE FUNCTION "task_assignee_leaves_with_member"();
