ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "title" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "workspace" text;