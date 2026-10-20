CREATE TABLE IF NOT EXISTS "account_chatgpt_host" (
	"user_id" text PRIMARY KEY,
	"ext_agent_host_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN IF NOT EXISTS "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_chatgpt_host" DROP CONSTRAINT IF EXISTS "account_chatgpt_host_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "account_chatgpt_host" ADD CONSTRAINT "account_chatgpt_host_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
