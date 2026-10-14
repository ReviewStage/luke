ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "rollout" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_revision" ADD COLUMN IF NOT EXISTS "rollout" jsonb DEFAULT '[]'::jsonb NOT NULL;
