-- Custom SQL migration file, put your code below! --
-- Temporary, beside "task_number_fallback", for the deployment before tasks were numbered: its code moves a task to another workspace without a number of the workspace it lands in, so a move that keeps the number it had takes the next one there, from the counter the new code numbers from. The new code's own move names the next number itself, which this leaves standing. The contract that removes workspace issues drops it.
CREATE OR REPLACE FUNCTION "task_number_move_fallback"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "task_number_counter" ("organization_id", "last_number") VALUES (NEW."organization_id", 1)
	ON CONFLICT ("organization_id") DO UPDATE SET "last_number" = "task_number_counter"."last_number" + 1
	RETURNING "last_number" INTO NEW."number";
	RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "task_number_move_fallback" ON "task";
--> statement-breakpoint
CREATE TRIGGER "task_number_move_fallback" BEFORE UPDATE OF "organization_id" ON "task" FOR EACH ROW WHEN (NEW."organization_id" IS DISTINCT FROM OLD."organization_id" AND NEW."number" = OLD."number") EXECUTE FUNCTION "task_number_move_fallback"();
