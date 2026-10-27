-- The migrator runs every folder inside one transaction, so CONCURRENTLY is unavailable here.
-- Measured on the luke project's default branch 2026-10-23 20:31 UTC: messages 35,833 rows (28 MB
-- of heap, 654 MB with its TOAST, which an index on turn_id never reads), turns 11,754,
-- conversations 2,467, chat_message 6,039, voice_sessions 468, operator_notice 428,
-- automation_run 81, token_pull_request_poll 0, so each build holds its table's write lock for
-- well under a second and needs no online step before the deploy.
CREATE INDEX IF NOT EXISTS "automation_run_status_fired" ON "automation_run" ("status","fired_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_run_unrecorded_settled" ON "automation_run" ("status","settled_at") WHERE "coding_agent_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_notice_unread_kind_at" ON "operator_notice" ("kind","at") WHERE "read_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_parent" ON "conversations" ("parent_conversation_id") WHERE "parent_conversation_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_turn" ON "messages" ("turn_id") WHERE "turn_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_pull_request_poll_due" ON "token_pull_request_poll" ("next_poll_at","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_sessions_task" ON "voice_sessions" ("task_id") WHERE "task_id" is not null;