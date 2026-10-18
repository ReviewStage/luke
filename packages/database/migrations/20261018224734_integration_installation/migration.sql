CREATE TABLE IF NOT EXISTS "integration_install_intent" (
	"state_hash" text PRIMARY KEY,
	"provider" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_installation" (
	"provider" text,
	"external_id" text,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"linked_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "integration_installation_pkey" PRIMARY KEY("provider","external_id")
);
--> statement-breakpoint
-- Both tables are new and empty, so the index is built in the migration.
CREATE INDEX IF NOT EXISTS "integration_installation_organization_id_idx" ON "integration_installation" ("organization_id");--> statement-breakpoint
ALTER TABLE "integration_install_intent" DROP CONSTRAINT IF EXISTS "integration_install_intent_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "integration_install_intent" ADD CONSTRAINT "integration_install_intent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_install_intent" DROP CONSTRAINT IF EXISTS "integration_install_intent_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "integration_install_intent" ADD CONSTRAINT "integration_install_intent_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_installation" DROP CONSTRAINT IF EXISTS "integration_installation_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "integration_installation" ADD CONSTRAINT "integration_installation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_installation" DROP CONSTRAINT IF EXISTS "integration_installation_linked_by_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "integration_installation" ADD CONSTRAINT "integration_installation_linked_by_user_id_user_id_fkey" FOREIGN KEY ("linked_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;