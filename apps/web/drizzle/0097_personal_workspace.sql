CREATE TABLE "personal_workspace" (
	"user_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_workspace_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "personal_workspace" ADD CONSTRAINT "personal_workspace_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_workspace" ADD CONSTRAINT "personal_workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Every account standing gets its own workspace in one statement: the
-- organization Better Auth would have written, its owner row, and the row
-- naming it the account's. `lacking` is materialized once, so the three
-- inserts share each account's one generated id.
WITH "lacking" AS (
	SELECT "user"."id" AS "user_id", "user"."name", gen_random_uuid()::text AS "organization_id"
	FROM "user"
	WHERE NOT EXISTS (
		SELECT 1 FROM "personal_workspace" WHERE "personal_workspace"."user_id" = "user"."id"
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
SELECT "user_id", "organization_id", now() FROM "lacking";
