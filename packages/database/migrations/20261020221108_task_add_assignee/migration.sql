ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "assignee_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_organization_assignee" ON "task" ("organization_id","assignee_id");--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_assignee_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_user_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
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
