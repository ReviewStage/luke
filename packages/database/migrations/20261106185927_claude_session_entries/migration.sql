CREATE TABLE "claude_session_entries" (
	"id" bigserial PRIMARY KEY,
	"conversation_id" uuid NOT NULL,
	"project_key" text NOT NULL,
	"session_id" text NOT NULL,
	"subpath" text,
	"entry" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "claude_session_entries_key_idx" ON "claude_session_entries" ("conversation_id","project_key","session_id","subpath","id");--> statement-breakpoint
ALTER TABLE "claude_session_entries" ADD CONSTRAINT "claude_session_entries_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;