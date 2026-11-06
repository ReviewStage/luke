-- A row naming no agent that stands (gone, or never a uuid) goes first, since no other path would delete it before its account goes.
DELETE FROM "sandbox_firewall" WHERE "agent_id" IS NOT NULL AND "agent_id" NOT IN (SELECT "id"::text FROM "agent");--> statement-breakpoint
ALTER TABLE "sandbox_firewall" ALTER COLUMN "agent_id" SET DATA TYPE uuid USING "agent_id"::uuid;--> statement-breakpoint
ALTER TABLE "sandbox_firewall" ADD CONSTRAINT "sandbox_firewall_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;