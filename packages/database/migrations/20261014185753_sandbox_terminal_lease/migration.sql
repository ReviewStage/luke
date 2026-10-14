CREATE TABLE "sandbox_terminal_lease" (
	"conversation_id" uuid PRIMARY KEY,
	"held_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sandbox_terminal_lease_held_until" ON "sandbox_terminal_lease" ("held_until");--> statement-breakpoint
ALTER TABLE "sandbox_terminal_lease" ADD CONSTRAINT "sandbox_terminal_lease_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;