-- Custom SQL migration file, put your code below! --
-- An account's first workspace made while it was made as "Personal" (#2740,
-- merged 2026-10-15 02:20 UTC, until its revert) takes its owner's account
-- name, as one made before or after holds, which is what Better Auth's own
-- invitation read says it is called; every read of Luke's names it by its
-- owner's name already (`workspace-store.ts`'s `WORKSPACE_NAME`). Only a
-- first workspace still called "Personal" is renamed, so a rerun changes
-- nothing.
UPDATE "organization" SET "name" = "user"."name"
FROM "personal_workspace"
JOIN "user" ON "user"."id" = "personal_workspace"."user_id"
WHERE "personal_workspace"."organization_id" = "organization"."id"
	AND "organization"."name" = 'Personal'
	AND "organization"."created_at" >= '2026-10-15 02:20:00+00';
