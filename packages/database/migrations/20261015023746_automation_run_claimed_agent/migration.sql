ALTER TABLE "automation_run" ADD COLUMN IF NOT EXISTS "claimed_agent_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_claimed_agent_id_coding_agent_id_fkey" FOREIGN KEY ("claimed_agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
