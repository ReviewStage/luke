-- Idempotent, because a Preview database that ran this table's first migration, under an earlier folder
-- name, already holds the table and both its keys: there each statement leaves what stands and creates only
-- what is missing, its index, and a database that never had the table creates all of it once.
CREATE TABLE IF NOT EXISTS "agent_runner_record" (
	"user_id" text,
	"session_id" text,
	"agent_id" uuid NOT NULL,
	"sandbox_name" text NOT NULL,
	"first_sequence" bigint NOT NULL,
	"fingerprint" text,
	"sandbox_session_id" text,
	"command_id" text,
	CONSTRAINT "agent_runner_record_pkey" PRIMARY KEY("user_id","session_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runner_record_agent" ON "agent_runner_record" ("agent_id");--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"agent_runner_record"'::regclass AND conname = 'agent_runner_record_user_id_user_id_fkey') THEN ALTER TABLE "agent_runner_record" ADD CONSTRAINT "agent_runner_record_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"agent_runner_record"'::regclass AND conname = 'agent_runner_record_agent_id_agent_id_fkey') THEN ALTER TABLE "agent_runner_record" ADD CONSTRAINT "agent_runner_record_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE; END IF; END $$;
