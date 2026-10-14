-- Custom SQL migration file, put your code below! --
-- Every plan standing moves into its starter's personal workspace, which the
-- personal workspace backfill before this made for every account, so none is
-- left without one. The migration before adds the column nullable so this
-- can fill it, and the one after holds it not null, as the schema declares.
UPDATE "plan" SET "organization_id" = "personal_workspace"."organization_id"
FROM "personal_workspace"
WHERE "personal_workspace"."user_id" = "plan"."user_id"
	AND "plan"."organization_id" IS NULL;
