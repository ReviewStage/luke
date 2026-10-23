-- Expand: the conversation's dispatch claim, which a hand-over to the runtime commits before it is made and clears after, in place of an advisory lock held across it, and the claim an ask was handed over under. Each column is nullable with no default, so adding it rewrites no row and holds each table's lock only for the catalog change, whatever the tables' size.
ALTER TABLE "asks" ADD COLUMN IF NOT EXISTS "dispatch_claim" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "dispatch_claim" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "dispatch_claimed_at" timestamp with time zone;
