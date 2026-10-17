-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "touched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "ask" jsonb;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "ask_key" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "ask_revision" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "ask_status" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "answer" jsonb;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "answer_key" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "answered_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN IF NOT EXISTS "closed_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_author_ask_key" ON "chat_message" ("author_member_id","ask_key") WHERE "ask_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_organization_ask_status" ON "chat_message" ("organization_id","ask_status") WHERE "ask_key" is not null;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_answered_by_member_id_chat_member_id_fkey" FOREIGN KEY ("answered_by_member_id") REFERENCES "chat_member"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_ask_whole" CHECK (("ask_key" is null) = ("ask" is null)
        and ("ask_key" is null) = ("ask_revision" is null)
        and ("ask_key" is null) = ("ask_status" is null));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;