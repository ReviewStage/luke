ALTER TABLE "mac_device" ADD COLUMN IF NOT EXISTS "home" text NOT NULL;--> statement-breakpoint
ALTER TABLE "mac_device" ADD COLUMN IF NOT EXISTS "claude_executable" text NOT NULL;