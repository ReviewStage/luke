-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
CREATE TABLE IF NOT EXISTS "pull_request_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"repository" text NOT NULL,
	"pull_request_number" integer NOT NULL,
	"base_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"status" text NOT NULL,
	"failure_kind" text,
	"model" text,
	"chapters" jsonb,
	"claim" uuid DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pull_request_chapters_head" ON "pull_request_chapters" ("organization_id","repository","pull_request_number","head_sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_request_chapters_latest" ON "pull_request_chapters" ("organization_id","repository","pull_request_number","started_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pull_request_chapters" ADD CONSTRAINT "pull_request_chapters_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pull_request_chapters" ADD CONSTRAINT "pull_request_chapters_requested_by_user_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;