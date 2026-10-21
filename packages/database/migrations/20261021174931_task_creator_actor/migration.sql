ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "creator_actor" text DEFAULT 'developer' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "creator_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_creator_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_creator_agent_id_coding_agent_id_fkey" FOREIGN KEY ("creator_agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;
