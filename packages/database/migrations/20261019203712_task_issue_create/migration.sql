-- Idempotent, so a database that ran this change under an earlier draft runs it again as a no-op.
-- The workspace issue's index on "task" is renamed first, because an index and a table share one namespace,
-- and only while "task_issue" is still that index, since a rename of a relation is not held to its kind.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relname = 'task_issue' AND c.relkind = 'i'
	) THEN
		ALTER INDEX "task_issue" RENAME TO "task_workspace_issue";
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"task_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"repository" text,
	"number" integer,
	"key" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"relation" text DEFAULT 'closes' NOT NULL,
	"linked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_issue_github_numbered" CHECK ("provider" <> 'github' or ("repository" is not null and "number" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_issue_task_provider_external" ON "task_issue" ("task_id","provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_issue_provider_external" ON "task_issue" ("provider","external_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_issue" ADD CONSTRAINT "task_issue_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_issue" ADD CONSTRAINT "task_issue_linked_by_user_id_fkey" FOREIGN KEY ("linked_by") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
