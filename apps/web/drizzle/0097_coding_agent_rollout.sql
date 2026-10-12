ALTER TABLE "coding_agent" ADD COLUMN IF NOT EXISTS "rollout_position" integer;
--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN IF NOT EXISTS "base_branch" text;
