-- The contract that removes Luke's own workspace issues, once no running build reads what it drops. #3966's fallbacks numbered a task the build before numbering inserted or moved; every build now numbers its own through "task_number_counter", which stays. Each trigger goes before the function it calls.
DROP TRIGGER IF EXISTS "task_number_move_fallback" ON "task";--> statement-breakpoint
DROP TRIGGER IF EXISTS "task_number_fallback" ON "task";--> statement-breakpoint
DROP FUNCTION IF EXISTS "task_number_move_fallback"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "task_number_fallback"();--> statement-breakpoint
-- A task's issues are its links in "task_issue" (#3972), and Luke keeps no issues of its own (#4016): the index before its column, and the column that references "issue" before the table.
DROP INDEX IF EXISTS "task_workspace_issue";--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_issue_id_issue_id_fkey";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "issue_id";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "linear_issue";--> statement-breakpoint
DROP TABLE IF EXISTS "issue";
