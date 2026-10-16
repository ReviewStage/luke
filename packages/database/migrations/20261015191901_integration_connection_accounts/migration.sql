-- An account may hold more than one account at a provider, each a row of its
-- own: the row gets an id of its own as its key, the subject Connect holds its
-- grant under, the connection name it goes by, a label, and a primary flag.
-- Every row standing now is the first account at its provider, so it keeps
-- asking Connect under its user id, as every ask did before, is named after
-- its provider, and is that provider's primary; no grant moves. A subject is
-- unique per provider, not across them, because the first account at every
-- provider asks under the same user id. Each step stands on its own guard,
-- so a run that stopped partway is finished by the next.
ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "id" text;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "connect_subject" text;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "connection_name" text;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "label" text;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "integration_connection" SET
	"id" = gen_random_uuid()::text,
	"connect_subject" = "user_id",
	"connection_name" = "provider",
	"is_primary" = true
WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "integration_connection" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connection" ALTER COLUMN "connect_subject" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connection" ALTER COLUMN "connection_name" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'integration_connection'::regclass AND contype = 'p' AND conname = 'integration_connection_pkey'
	) THEN
		ALTER TABLE "integration_connection" DROP CONSTRAINT IF EXISTS "integration_connection_user_id_provider_pk";
		ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_pkey" PRIMARY KEY ("id");
	END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "integration_connection_subject_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connection_user_name_idx" ON "integration_connection" ("user_id","connection_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connection_provider_subject_idx" ON "integration_connection" ("provider","connect_subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_connection_user_provider_idx" ON "integration_connection" ("user_id","provider");
