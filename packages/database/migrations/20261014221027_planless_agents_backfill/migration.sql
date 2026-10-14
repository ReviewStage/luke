-- Custom SQL migration file, put your code below! --
-- Every agent, inbox item, and attachment standing takes its plan's
-- workspace, and every agent its one repository as the list, so the columns
-- the migration before added read the same as a new row's. Rows filled
-- already are left as they are.
UPDATE "coding_agent" SET "organization_id" = "plan"."organization_id"
FROM "plan"
WHERE "plan"."id" = "coding_agent"."plan_id"
	AND "coding_agent"."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "coding_agent" SET "repositories" = jsonb_build_array("repository")
WHERE "repositories" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "inbox_item" SET "organization_id" = "plan"."organization_id"
FROM "plan"
WHERE "plan"."id" = "inbox_item"."plan_id"
	AND "inbox_item"."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "inbox_attachment" SET "organization_id" = "plan"."organization_id"
FROM "plan"
WHERE "plan"."id" = "inbox_attachment"."plan_id"
	AND "inbox_attachment"."organization_id" IS NULL;
