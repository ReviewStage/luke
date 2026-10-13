CREATE TABLE IF NOT EXISTS "session_sandbox_cleanup" (
	"session_id" text PRIMARY KEY NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tried_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_sandbox_cleanup_next" ON "session_sandbox_cleanup" USING btree ("tried_at","queued_at");
