CREATE TABLE IF NOT EXISTS "inbox_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"author" text NOT NULL,
	"user_id" text,
	"text" text NOT NULL,
	"client_key" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- A nullable column with no default is written to the catalog alone, so no row of the table is rewritten; the same holds below.
ALTER TABLE "inbox_attachment" ADD COLUMN IF NOT EXISTS "message_id" uuid;--> statement-breakpoint
-- No backfill: a read takes a settled item's last change for a null settled_at, and the first message on its thread keeps that instant here before moving the change (`inbox-store.ts`).
ALTER TABLE "inbox_item" ADD COLUMN IF NOT EXISTS "settled_at" timestamp with time zone;--> statement-breakpoint
-- The table holds a few rows per item, their bytes stored out of line, and the column is null on every one, so the build reads little under its lock.
CREATE INDEX IF NOT EXISTS "inbox_attachment_message" ON "inbox_attachment" ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_message_item_created" ON "inbox_message" ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_message_client_key" ON "inbox_message" ("item_id","client_key") WHERE "client_key" is not null;--> statement-breakpoint
ALTER TABLE "inbox_attachment" DROP CONSTRAINT IF EXISTS "inbox_attachment_message_id_inbox_message_id_fkey";--> statement-breakpoint
-- Every row standing names no message, so the constraint is not validated over them: a validation would read the whole table under a lock that holds back every attachment written meanwhile.
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_message_id_inbox_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "inbox_message"("id") ON DELETE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "inbox_message" DROP CONSTRAINT IF EXISTS "inbox_message_item_id_inbox_item_id_fkey";--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_item_id_inbox_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inbox_item"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inbox_message" DROP CONSTRAINT IF EXISTS "inbox_message_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "inbox_attachment" DROP CONSTRAINT IF EXISTS "inbox_attachment_kind_bound";--> statement-breakpoint
-- Every row standing is a picture or an answer's file and names no message, which the old check already held of it, so the new one is not validated over them, for the reason above.
ALTER TABLE "inbox_attachment" ADD CONSTRAINT "inbox_attachment_kind_bound" CHECK (("kind" = 'image' and octet_length("bytes") <= 1500000 and "name" is null and "position" is null and "message_id" is null) or ("kind" = 'answer' and octet_length("bytes") <= 3000000 and "name" is not null and "position" is not null and "message_id" is null) or ("kind" = 'message' and octet_length("bytes") <= 3000000 and "name" is not null and "position" is not null and "message_id" is not null)) NOT VALID;
