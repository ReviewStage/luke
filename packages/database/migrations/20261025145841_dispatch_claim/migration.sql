-- Expand: the conversation's dispatch claim, which a hand-over to the runtime commits before it is made and clears after, in place of an advisory lock held across it, with the line it hands over; the claim an ask was handed over under; and the queue of hand-overs waiting for a claim, served in the order they queued. Each new column is nullable with no default, so adding it rewrites no row and holds each table's lock only for the catalog change, whatever the tables' size; the queue's table and its index are new and empty.
CREATE TABLE "dispatch_waiters" (
	"place" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dispatch_waiters_place_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN IF NOT EXISTS "dispatch_claim" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "dispatch_claim" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "dispatch_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "dispatch_line" uuid;--> statement-breakpoint
CREATE INDEX "dispatch_waiters_conversation_place" ON "dispatch_waiters" ("conversation_id","place");--> statement-breakpoint
ALTER TABLE "dispatch_waiters" ADD CONSTRAINT "dispatch_waiters_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;