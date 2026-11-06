CREATE TABLE "account_chatgpt_device_login" (
	"user_id" text PRIMARY KEY,
	"login_id" text NOT NULL,
	"sealed_codes" text,
	"outcome" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_chatgpt_device_login" ADD CONSTRAINT "account_chatgpt_device_login_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;