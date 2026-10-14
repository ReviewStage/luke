DROP INDEX IF EXISTS "sandbox_terminal_lease_held_until";--> statement-breakpoint
ALTER TABLE "sandbox_terminal_lease" ADD COLUMN IF NOT EXISTS "tried_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandbox_terminal_lease_next" ON "sandbox_terminal_lease" ("tried_at","held_until");
