-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
CREATE TABLE IF NOT EXISTS "chat_read" (
	"member_id" uuid,
	"channel_id" uuid,
	"read_seq" integer NOT NULL,
	CONSTRAINT "chat_read_pkey" PRIMARY KEY("member_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "chat_member" ADD COLUMN IF NOT EXISTS "notice_channel_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_read_channel" ON "chat_read" ("channel_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_notice_channel_id_chat_channel_id_fkey" FOREIGN KEY ("notice_channel_id") REFERENCES "chat_channel"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_read" ADD CONSTRAINT "chat_read_member_id_chat_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "chat_member"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_read" ADD CONSTRAINT "chat_read_channel_id_chat_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat_channel"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;