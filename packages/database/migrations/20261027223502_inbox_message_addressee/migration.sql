ALTER TABLE "inbox_message" ADD COLUMN "addressee_id" text;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_addressee_id_user_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
UPDATE "inbox_message" SET "addressee_id" = "inbox_item"."addressee_id"
FROM "inbox_item"
WHERE "inbox_item"."open_ask_message_id" = "inbox_message"."id"
	AND "inbox_item"."addressee_id" IS NOT NULL
	AND "inbox_message"."addressee_id" IS NULL;
