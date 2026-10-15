CREATE TABLE IF NOT EXISTS "conversation_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_count" integer NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_attachment_bytes_bound" CHECK (octet_length("bytes") <= 4000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_attachment_conversation_sha256" ON "conversation_attachment" ("conversation_id","sha256");--> statement-breakpoint
ALTER TABLE "conversation_attachment" DROP CONSTRAINT IF EXISTS "conversation_attachment_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_attachment" DROP CONSTRAINT IF EXISTS "conversation_attachment_conversation_id_conversations_id_fkey";--> statement-breakpoint
ALTER TABLE "conversation_attachment" ADD CONSTRAINT "conversation_attachment_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;