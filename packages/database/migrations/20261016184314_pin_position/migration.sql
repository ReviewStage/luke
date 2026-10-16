ALTER TABLE "agent_pin" ADD COLUMN IF NOT EXISTS "position" text;--> statement-breakpoint
ALTER TABLE "plan_pin" ADD COLUMN IF NOT EXISTS "position" text;