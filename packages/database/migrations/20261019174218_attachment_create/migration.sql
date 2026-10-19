-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
-- Expand: chat pictures are written here beside "chat_attachment", which is still read.
CREATE TABLE IF NOT EXISTS "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"chat_message_id" uuid,
	"content_type" text NOT NULL,
	"byte_count" integer NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attachment_one_owner" CHECK (num_nonnulls("chat_message_id") = 1),
	CONSTRAINT "attachment_bytes_bound" CHECK ("chat_message_id" is null or octet_length("bytes") <= 1500000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_chat_message" ON "attachment" ("chat_message_id") WHERE "chat_message_id" is not null;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "attachment" ADD CONSTRAINT "attachment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "attachment" ADD CONSTRAINT "attachment_chat_message_id_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "chat_message"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
