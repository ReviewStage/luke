CREATE TABLE IF NOT EXISTS "coding_agent_runner_lease" (
	"agent_id" uuid PRIMARY KEY,
	"holder" uuid NOT NULL,
	"held_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coding_agent_runner_lease" DROP CONSTRAINT IF EXISTS "coding_agent_runner_lease_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "coding_agent_runner_lease" ADD CONSTRAINT "coding_agent_runner_lease_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;
