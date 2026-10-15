ALTER TABLE "inbox_item" ADD COLUMN IF NOT EXISTS "answered_by" text;--> statement-breakpoint
ALTER TABLE "inbox_item" DROP CONSTRAINT IF EXISTS "inbox_item_answered_by_user_id_fkey";--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_answered_by_user_id_fkey" FOREIGN KEY ("answered_by") REFERENCES "user"("id") ON DELETE SET NULL;
