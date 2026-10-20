CREATE TABLE IF NOT EXISTS "task_number_counter" (
	"organization_id" text PRIMARY KEY,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_number_counter" DROP CONSTRAINT IF EXISTS "task_number_counter_organization_id_organization_id_fkey";
--> statement-breakpoint
ALTER TABLE "task_number_counter" ADD CONSTRAINT "task_number_counter_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'todo' NOT NULL;
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
-- Nothing is backfilled (there are no users): the tasks standing are only numbered in the order they were made, per workspace, so the column can be NOT NULL, and each workspace's counter starts past its last.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "number" integer;
--> statement-breakpoint
UPDATE "task" SET "number" = "numbered"."number"
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "organization_id" ORDER BY "created_at", "id")::int AS "number"
	FROM "task"
) AS "numbered"
WHERE "task"."id" = "numbered"."id" AND "task"."number" IS NULL;
--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "number" SET NOT NULL;
--> statement-breakpoint
INSERT INTO "task_number_counter" ("organization_id", "last_number")
SELECT "organization_id", max("number") FROM "task" GROUP BY "organization_id"
ON CONFLICT ("organization_id") DO UPDATE SET "last_number" = greatest("task_number_counter"."last_number", excluded."last_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_organization_number" ON "task" ("organization_id","number");
--> statement-breakpoint
-- Temporary, for the deployment before this one: its code inserts a task without a number, so a task it makes takes its workspace's next one here, from the same counter the new code numbers from. The contract that removes workspace issues drops it.
CREATE OR REPLACE FUNCTION "task_number_fallback"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "task_number_counter" ("organization_id", "last_number") VALUES (NEW."organization_id", 1)
	ON CONFLICT ("organization_id") DO UPDATE SET "last_number" = "task_number_counter"."last_number" + 1
	RETURNING "last_number" INTO NEW."number";
	RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "task_number_fallback" ON "task";
--> statement-breakpoint
CREATE TRIGGER "task_number_fallback" BEFORE INSERT ON "task" FOR EACH ROW WHEN (NEW."number" IS NULL) EXECUTE FUNCTION "task_number_fallback"();
