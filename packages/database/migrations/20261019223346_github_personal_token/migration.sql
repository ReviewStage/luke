CREATE TABLE IF NOT EXISTS "github_personal_token" (
	"user_id" text PRIMARY KEY,
	"key_version" integer NOT NULL,
	"sealed_data_key" text NOT NULL,
	"sealed_token" text NOT NULL,
	"hint" text NOT NULL,
	"github_user_id" text NOT NULL,
	"github_login" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_personal_token" DROP CONSTRAINT IF EXISTS "github_personal_token_user_id_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "github_personal_token" ADD CONSTRAINT "github_personal_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;