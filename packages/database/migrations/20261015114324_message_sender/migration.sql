ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender_user_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender_name" text;--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_sender_user_id_user_id_fkey";--> statement-breakpoint
-- Every row standing has no sender, so the constraint is not validated over them: a validation would read the whole table under a lock that holds back every message written meanwhile.
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "user"("id") ON DELETE SET NULL NOT VALID;
