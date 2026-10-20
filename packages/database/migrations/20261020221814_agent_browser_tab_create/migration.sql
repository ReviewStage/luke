CREATE TABLE IF NOT EXISTS "agent_browser_tab" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"conversation_id" uuid NOT NULL,
	"task_id" uuid,
	"target_id" text NOT NULL,
	"address" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"opened_by" text NOT NULL,
	"opened_by_user_id" text,
	"driver_user_id" text,
	"held_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_acted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_browser_tab_conversation_target" ON "agent_browser_tab" ("conversation_id","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_browser_tab_task_created" ON "agent_browser_tab" ("task_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_browser_tab" DROP CONSTRAINT IF EXISTS "agent_browser_tab_conversation_id_conversations_id_fkey";--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD CONSTRAINT "agent_browser_tab_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" DROP CONSTRAINT IF EXISTS "agent_browser_tab_task_id_task_id_fkey";--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD CONSTRAINT "agent_browser_tab_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" DROP CONSTRAINT IF EXISTS "agent_browser_tab_opened_by_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD CONSTRAINT "agent_browser_tab_opened_by_user_id_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "agent_browser_tab" DROP CONSTRAINT IF EXISTS "agent_browser_tab_driver_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ADD CONSTRAINT "agent_browser_tab_driver_user_id_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "user"("id") ON DELETE SET NULL;