ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;
--> statement-breakpoint
-- Nothing recorded when a task was finished before this column, so a task
-- standing Done or Canceled counts as finished at its last save, the nearest
-- instant the row keeps. Only nulls are filled, so a rerun changes nothing.
UPDATE "task" SET "completed_at" = "updated_at"
WHERE "status" IN ('done', 'canceled') AND "completed_at" IS NULL;
