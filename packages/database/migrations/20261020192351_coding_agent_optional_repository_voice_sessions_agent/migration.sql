-- Widening only: a nullable column, a dropped NOT NULL, and a foreign key no existing row can
-- break (every agent_id is null), so the deployment before this one keeps working unchanged.
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "coding_agent" ALTER COLUMN "repository" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_sessions_agent" ON "voice_sessions" ("agent_id");--> statement-breakpoint
ALTER TABLE "voice_sessions" DROP CONSTRAINT IF EXISTS "voice_sessions_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE SET NULL;
