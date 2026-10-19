-- Expand only: three nullable columns with no default, each written to the catalog alone, so no row of either table is rewritten and nothing an older deployment writes is refused. Nothing is backfilled: a message from before version 5 asks and answers nothing, and an item from before it has no ask open.
-- "inbox_message" is altered before "inbox_item", the order a message written or deleted on a thread takes the two in, so this waits behind such a write rather than deadlocking with it.
ALTER TABLE "inbox_message" ADD COLUMN IF NOT EXISTS "ask" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN IF NOT EXISTS "answers" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN IF NOT EXISTS "open_ask_message_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_item" DROP CONSTRAINT IF EXISTS "inbox_item_open_ask_message_id_inbox_message_id_fkey";--> statement-breakpoint
-- Every row standing names no message, so the constraint is not validated over them: a validation would read the whole table under a lock that holds back every item written meanwhile.
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_open_ask_message_id_inbox_message_id_fkey" FOREIGN KEY ("open_ask_message_id") REFERENCES "inbox_message"("id") ON DELETE SET NULL NOT VALID;
