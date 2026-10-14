CREATE TABLE "github_connect_intent" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_connect_intent_user_id_idx" ON "github_connect_intent" ("user_id");--> statement-breakpoint
ALTER TABLE "github_connect_intent" ADD CONSTRAINT "github_connect_intent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;