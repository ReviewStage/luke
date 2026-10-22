CREATE TABLE IF NOT EXISTS "coding_agent_wakeup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coding_agent_wakeup_due" ON "coding_agent_wakeup" ("due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coding_agent_wakeup_agent" ON "coding_agent_wakeup" ("agent_id");--> statement-breakpoint
ALTER TABLE "coding_agent_wakeup" DROP CONSTRAINT IF EXISTS "coding_agent_wakeup_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "coding_agent_wakeup" ADD CONSTRAINT "coding_agent_wakeup_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;
