ALTER TABLE "automation_run" ADD COLUMN "task_id" uuid;--> statement-breakpoint
CREATE INDEX "automation_run_task" ON "automation_run" ("task_id") WHERE "task_id" is not null;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE SET NULL;