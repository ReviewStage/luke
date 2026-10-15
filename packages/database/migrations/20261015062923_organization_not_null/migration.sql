-- The contract step of automations' workspaces: every automation, agent,
-- inbox item, and attachment belongs to a workspace. The backfills of the
-- expand step run again first, so a row written between them and the code
-- that sets the column takes its plan's workspace, or its agent's, or its
-- item's, before the column refuses a null. Rows filled already are left as
-- they are, and SET NOT NULL is a no-op on a column that already is.
UPDATE "automation" SET "organization_id" = "plan"."organization_id"
FROM "plan"
WHERE "plan"."id" = "automation"."plan_id"
	AND "automation"."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "coding_agent" SET "organization_id" = "plan"."organization_id"
FROM "plan"
WHERE "plan"."id" = "coding_agent"."plan_id"
	AND "coding_agent"."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "inbox_item" SET "organization_id" = "plan"."organization_id"
FROM "plan"
WHERE "plan"."id" = "inbox_item"."plan_id"
	AND "inbox_item"."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "inbox_item" SET "organization_id" = "coding_agent"."organization_id"
FROM "coding_agent"
WHERE "coding_agent"."id" = "inbox_item"."agent_id"
	AND "inbox_item"."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "inbox_attachment" SET "organization_id" = "inbox_item"."organization_id"
FROM "inbox_item"
WHERE "inbox_item"."id" = "inbox_attachment"."item_id"
	AND "inbox_attachment"."organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coding_agent" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ALTER COLUMN "organization_id" SET NOT NULL;
