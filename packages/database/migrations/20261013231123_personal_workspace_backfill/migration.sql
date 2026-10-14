-- Custom SQL migration file, put your code below! --
-- An account whose personal slug is already taken, by an ensure that made
-- the organization and not yet the row, adopts that organization first, as
-- the next ensure would, so no account is left without a row for the plan
-- backfill after this to read.
INSERT INTO "personal_workspace" ("user_id", "organization_id", "created_at")
SELECT "user"."id", "organization"."id", now()
FROM "user"
JOIN "organization" ON "organization"."slug" = 'personal-' || "user"."id"
WHERE NOT EXISTS (
	SELECT 1 FROM "personal_workspace" WHERE "personal_workspace"."user_id" = "user"."id"
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Every other account lacking a personal workspace gets one in one statement:
-- the organization Better Auth would have written, its owner row, and the row
-- naming it the account's. `lacking` is materialized once, so the three
-- inserts share each account's one generated id. Only what is missing is
-- written: an account that already has its row is left alone, so a second
-- run writes nothing.
WITH "lacking" AS (
	SELECT "user"."id" AS "user_id", "user"."name", gen_random_uuid()::text AS "organization_id"
	FROM "user"
	WHERE NOT EXISTS (
		SELECT 1 FROM "personal_workspace" WHERE "personal_workspace"."user_id" = "user"."id"
	)
	AND NOT EXISTS (
		SELECT 1 FROM "organization" WHERE "organization"."slug" = 'personal-' || "user"."id"
	)
), "organizations" AS (
	INSERT INTO "organization" ("id", "name", "slug", "created_at", "metadata")
	SELECT "organization_id", "name", 'personal-' || "user_id", now(), '{"personal":true}'
	FROM "lacking"
), "owners" AS (
	INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
	SELECT gen_random_uuid()::text, "organization_id", "user_id", 'owner', now()
	FROM "lacking"
)
INSERT INTO "personal_workspace" ("user_id", "organization_id", "created_at")
SELECT "user_id", "organization_id", now() FROM "lacking"
ON CONFLICT DO NOTHING;
