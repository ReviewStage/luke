CREATE TABLE IF NOT EXISTS "token_pull_request_poll" (
	"agent_id" uuid PRIMARY KEY,
	"pull_request" integer NOT NULL,
	"etags" jsonb DEFAULT '{}' NOT NULL,
	"last_review_id" bigint,
	"last_comment_id" bigint,
	"head_sha" text,
	"check_conclusion" text,
	"next_poll_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_pull_request_poll" DROP CONSTRAINT IF EXISTS "token_pull_request_poll_agent_id_coding_agent_id_fkey";
--> statement-breakpoint
ALTER TABLE "token_pull_request_poll" ADD CONSTRAINT "token_pull_request_poll_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;
