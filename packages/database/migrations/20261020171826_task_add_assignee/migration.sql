ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "assignee_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_organization_assignee" ON "task" ("organization_id","assignee_id");--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_assignee_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_user_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL;
