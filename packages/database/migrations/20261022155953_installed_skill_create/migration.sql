CREATE TABLE IF NOT EXISTS "installed_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"organization_id" text,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"user_invocable" boolean DEFAULT true NOT NULL,
	"source" jsonb NOT NULL,
	"computed_hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installed_skill_scope_workspace" CHECK (("scope" = 'personal' and "organization_id" is null) or ("scope" = 'workspace' and "organization_id" is not null)),
	CONSTRAINT "installed_skill_name_rule" CHECK (char_length("name") <= 64 and "name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installed_skill_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"bytes" bytea NOT NULL,
	"sha256" text NOT NULL,
	CONSTRAINT "installed_skill_file_relative" CHECK ("path" <> '' and left("path", 1) <> '/' and "path" !~ '(^|/)\.\.?(/|$)' and position(chr(92) in "path") = 0),
	CONSTRAINT "installed_skill_file_bytes_bound" CHECK (octet_length("bytes") <= 1048576 and ("path" <> 'SKILL.md' or octet_length("bytes") <= 65536))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "installed_skill_personal_name" ON "installed_skill" ("user_id","name") WHERE "scope" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "installed_skill_workspace_name" ON "installed_skill" ("organization_id","name") WHERE "scope" = 'workspace';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "installed_skill_file_path" ON "installed_skill_file" ("skill_id","path");--> statement-breakpoint
ALTER TABLE "installed_skill" DROP CONSTRAINT IF EXISTS "installed_skill_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "installed_skill" ADD CONSTRAINT "installed_skill_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "installed_skill" DROP CONSTRAINT IF EXISTS "installed_skill_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "installed_skill" ADD CONSTRAINT "installed_skill_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "installed_skill_file" DROP CONSTRAINT IF EXISTS "installed_skill_file_skill_id_installed_skill_id_fkey";--> statement-breakpoint
ALTER TABLE "installed_skill_file" ADD CONSTRAINT "installed_skill_file_skill_id_installed_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "installed_skill"("id") ON DELETE CASCADE;