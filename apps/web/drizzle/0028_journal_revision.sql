ALTER TABLE "conversations" ADD COLUMN "journal_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "revision" bigint;--> statement-breakpoint
CREATE INDEX "messages_conversation_revision" ON "messages" USING btree ("conversation_id","revision") WHERE "messages"."revision" IS NOT NULL;