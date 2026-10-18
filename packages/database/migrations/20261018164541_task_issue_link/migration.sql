ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "issue_id" uuid;--> statement-breakpoint
-- The table held 161 rows (152 kB) when this was written, so the index is built in the migration rather than CONCURRENTLY by hand beforehand: its scan is shorter than a request.
CREATE INDEX IF NOT EXISTS "task_issue" ON "task" ("issue_id");--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_issue_id_issue_id_fkey";--> statement-breakpoint
-- Added unvalidated, so the add takes no scan under the lock that holds back every task written meanwhile; the validation after it scans under a lock that lets writes through.
ALTER TABLE "task" ADD CONSTRAINT "task_issue_id_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issue"("id") ON DELETE SET NULL NOT VALID;--> statement-breakpoint
ALTER TABLE "task" VALIDATE CONSTRAINT "task_issue_id_issue_id_fkey";
