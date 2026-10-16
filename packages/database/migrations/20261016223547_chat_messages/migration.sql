-- Idempotent, so a preview database that ran this change under an earlier draft folder name runs it again as a no-op.
CREATE TABLE IF NOT EXISTS "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"touched_seq" integer NOT NULL,
	"parent_id" uuid,
	"author_member_id" uuid NOT NULL,
	"blocks" jsonb NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_chat" (
	"organization_id" text PRIMARY KEY,
	"next_seq" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_organization_seq" ON "chat_message" ("organization_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_channel_client_key" ON "chat_message" ("channel_id","client_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_channel_seq" ON "chat_message" ("channel_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_parent_seq" ON "chat_message" ("parent_id","seq") WHERE "parent_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_organization_touched" ON "chat_message" ("organization_id","touched_seq");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_channel_id_chat_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat_channel"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_parent_id_chat_message_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chat_message"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_author_member_id_chat_member_id_fkey" FOREIGN KEY ("author_member_id") REFERENCES "chat_member"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_chat" ADD CONSTRAINT "workspace_chat_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;