CREATE TABLE IF NOT EXISTS "plan_pin" (
	"user_id" text,
	"plan_id" uuid,
	"pinned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "plan_pin_pkey" PRIMARY KEY("user_id","plan_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_pin_plan" ON "plan_pin" ("plan_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "plan_pin" ADD CONSTRAINT "plan_pin_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "plan_pin" ADD CONSTRAINT "plan_pin_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Every plan pinned on the shared row becomes a pin of its creator's, at the
-- instant it was pinned. Who pinned it was never recorded. The creator is
-- chosen because before team workspaces a plan's only member was the account
-- that started it, so there the creator is exactly who pinned it, and in a
-- team workspace the creator is still the likeliest pinner. Giving the pin to
-- every member would recreate the very sharing this ends, and dropping it
-- would lose the developer's arrangement. A pin already standing is left as
-- it is, so a second run writes nothing. `plan.pinned_at` stays, unread, for
-- a build from before this one until a later migration drops it.
INSERT INTO "plan_pin" ("user_id", "plan_id", "pinned_at")
SELECT "plan"."user_id", "plan"."id", "plan"."pinned_at"
FROM "plan"
WHERE "plan"."pinned_at" IS NOT NULL
ON CONFLICT DO NOTHING;
