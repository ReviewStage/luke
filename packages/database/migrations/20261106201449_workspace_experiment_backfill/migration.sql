-- Custom SQL migration file, put your code below! --
-- Task descriptions, Pilot, and Memory move from each account's choice to
-- the workspace's. A workspace takes each of them on where one of its owners
-- or admins had it on for their own account, so no one who used one loses
-- it; the changer is that owner or admin, an owner before an admin, then the
-- earliest to join, and the change is dated now. The plugin's role text may
-- list several roles comma-separated. An account's own choices stay where
-- they are, for builds that still read them; nothing reads them for these
-- three once this lands. Only a workspace with no row for the experiment is
-- written, so a second run writes nothing.
INSERT INTO "workspace_experiment" ("organization_id", "experiment", "on", "changed_by", "changed_at")
SELECT DISTINCT ON ("member"."organization_id", "chosen"."experiment")
	"member"."organization_id", "chosen"."experiment", true, "member"."user_id", now()
FROM "member"
JOIN "account_preference" ON "account_preference"."user_id" = "member"."user_id"
CROSS JOIN LATERAL (VALUES ('descriptions'), ('pilot'), ('memory')) AS "chosen" ("experiment")
WHERE "member"."role" ~ '(^|,)\s*(owner|admin)\s*(,|$)'
	AND ("account_preference"."experiments" ->> "chosen"."experiment") = 'true'
ORDER BY "member"."organization_id", "chosen"."experiment",
	("member"."role" ~ '(^|,)\s*owner\s*(,|$)') DESC, "member"."created_at", "member"."user_id"
ON CONFLICT ("organization_id", "experiment") DO NOTHING;
