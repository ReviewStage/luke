-- Custom SQL migration file, put your code below! --
-- Every automation made before automations left plans takes its plan's
-- workspace and its plan's repository, the one it ran in, so the columns the
-- migration before added read the same as a new row's. Rows filled already,
-- and rows whose plan has no repository, are left as they are.
UPDATE "automation" SET "organization_id" = "plan"."organization_id"
FROM "plan"
WHERE "plan"."id" = "automation"."plan_id"
	AND "automation"."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "automation" SET "repositories" = jsonb_build_array("plan"."repository")
FROM "plan"
WHERE "plan"."id" = "automation"."plan_id"
	AND "plan"."repository" IS NOT NULL
	AND "automation"."repositories" = '[]'::jsonb;
