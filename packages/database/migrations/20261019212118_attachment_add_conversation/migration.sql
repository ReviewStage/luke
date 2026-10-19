-- Idempotent, so a preview database that ran this under an earlier draft folder name runs it again as a no-op.
-- Expand: a conversation's picture's columns stand on "attachment" a deployment ahead of the move that copies the pictures in. The new foreign key needs "conversations" held against writes, which an agent's every turn makes while it holds its conversation's row, so it is added here, where nothing waits on a conversation's row: no row names a conversation yet. "conversations" is locked first, then "attachment"; no old writer of "attachment" writes "conversations", so none holds one while it waits on the other.
LOCK TABLE "conversations" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
LOCK TABLE "attachment" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "sha256" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "width" integer;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "height" integer;--> statement-breakpoint
DROP INDEX IF EXISTS "attachment_unsaved";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_unsaved" ON "attachment" ("created_at") WHERE ("task_id" is not null and num_nonnulls("chat_message_id", "inbox_item_id", "conversation_id") = 0) and "saved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attachment_conversation_sha256" ON "attachment" ("conversation_id","sha256");--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_conversation_id_conversations_id_fkey";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_conversation_picture";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_conversation_picture" CHECK ("conversation_id" is null or ("sha256" is not null and "width" is not null and "height" is not null));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_one_owner";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_one_owner" CHECK ((num_nonnulls("chat_message_id", "inbox_item_id", "conversation_id") = 1 or ("task_id" is not null and num_nonnulls("chat_message_id", "inbox_item_id", "conversation_id") = 0)) and ("inbox_message_id" is null or "inbox_item_id" is not null));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_bytes_bound";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_bytes_bound" CHECK (("chat_message_id" is null or octet_length("bytes") <= 1500000) and ("conversation_id" is null or octet_length("bytes") <= 4000000) and (not ("task_id" is not null and num_nonnulls("chat_message_id", "inbox_item_id", "conversation_id") = 0) or octet_length("bytes") <= 1500000));
