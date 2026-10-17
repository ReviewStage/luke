-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
CREATE TABLE IF NOT EXISTS "chat_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"byte_count" integer NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_attachment_bytes_bound" CHECK (octet_length("bytes") <= 1500000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_attachment_message" ON "chat_attachment" ("message_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_attachment" ADD CONSTRAINT "chat_attachment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_attachment" ADD CONSTRAINT "chat_attachment_message_id_chat_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_message"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;