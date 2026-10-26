CREATE TABLE "native_call_key" (
	"user_id" text,
	"conversation_id" uuid,
	"digest" text,
	"key" text NOT NULL,
	"minted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "native_call_key_pkey" PRIMARY KEY("user_id","conversation_id","digest")
);
--> statement-breakpoint
ALTER TABLE "native_call_key" ADD CONSTRAINT "native_call_key_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "native_call_key" ADD CONSTRAINT "native_call_key_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;