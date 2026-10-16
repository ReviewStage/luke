CREATE TABLE IF NOT EXISTS "plan_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"thread_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"actor" text NOT NULL,
	"user_id" text,
	"agent_id" uuid,
	"words" text,
	"asked_actor" text,
	"asked_agent_id" uuid,
	"client_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_comment_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plan_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"quote" text NOT NULL,
	"anchor_from" integer,
	"anchor_to" integer,
	"section" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_comment_thread_seq" ON "plan_comment" ("thread_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_comment_plan" ON "plan_comment" ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_comment_client_key" ON "plan_comment" ("plan_id","client_key") WHERE "client_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_comment_thread_plan_created" ON "plan_comment_thread" ("plan_id","created_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "plan_comment" ADD CONSTRAINT "plan_comment_thread_id_plan_comment_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "plan_comment_thread"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "plan_comment" ADD CONSTRAINT "plan_comment_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "plan_comment" ADD CONSTRAINT "plan_comment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "plan_comment" ADD CONSTRAINT "plan_comment_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "plan_comment" ADD CONSTRAINT "plan_comment_asked_agent_id_coding_agent_id_fkey" FOREIGN KEY ("asked_agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "plan_comment_thread" ADD CONSTRAINT "plan_comment_thread_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
