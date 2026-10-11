CREATE TABLE "coding_agent_delegation" (
	"child_conversation_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coding_agent_delegation" ADD CONSTRAINT "coding_agent_delegation_child_conversation_id_conversations_id_fk" FOREIGN KEY ("child_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
