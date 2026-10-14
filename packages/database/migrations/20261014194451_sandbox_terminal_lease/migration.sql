CREATE TABLE "sandbox_terminal_lease" (
	"conversation_id" uuid PRIMARY KEY,
	"held_until" timestamp with time zone NOT NULL,
	"tried_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "sandbox_terminal_lease_next" ON "sandbox_terminal_lease" ("tried_at","held_until");--> statement-breakpoint
ALTER TABLE "sandbox_terminal_lease" ADD CONSTRAINT "sandbox_terminal_lease_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;