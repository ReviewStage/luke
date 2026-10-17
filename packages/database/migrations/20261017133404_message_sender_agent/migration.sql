ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender_model" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender_agent_id" uuid;
