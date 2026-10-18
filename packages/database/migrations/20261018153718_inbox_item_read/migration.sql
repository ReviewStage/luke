CREATE TABLE IF NOT EXISTS "inbox_item_read" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"read_through" timestamp with time zone,
	"marked_unread" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
-- No backfill: `now()` is stable, so this default is evaluated once and kept in the catalog as the value of every row standing, with no row of the table rewritten. Every item that stands when unread ships reads as read through that instant, for every member, until it changes again.
ALTER TABLE "inbox_item" ADD COLUMN IF NOT EXISTS "read_through" timestamp with time zone DEFAULT now();--> statement-breakpoint
-- The default is dropped in the same transaction, so an item posted from here on holds null and reads unread until a member reads it (`inbox-store.ts`). The standing rows keep the value the catalog stamped them with.
ALTER TABLE "inbox_item" ALTER COLUMN "read_through" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_item_read_item_user" ON "inbox_item_read" ("item_id","user_id");--> statement-breakpoint
ALTER TABLE "inbox_item_read" DROP CONSTRAINT IF EXISTS "inbox_item_read_item_id_inbox_item_id_fkey";--> statement-breakpoint
ALTER TABLE "inbox_item_read" ADD CONSTRAINT "inbox_item_read_item_id_inbox_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inbox_item"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inbox_item_read" DROP CONSTRAINT IF EXISTS "inbox_item_read_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "inbox_item_read" ADD CONSTRAINT "inbox_item_read_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
