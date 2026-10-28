-- The contract step of the features cut on Oct 28 (GPT Live, video calls, the task whiteboard, task issue links, the workspace Linear connection, and the plan template): every release since the one that undeclared these reads and writes none of them. No table kept references one, and each that references another goes before it.
DROP TABLE "asks";--> statement-breakpoint
-- Dropping the table took its capture triggers; the function they called is no table's, so it goes after them.
DROP FUNCTION IF EXISTS "luke_sync_asks"();--> statement-breakpoint
-- No capture names these columns: 20261028205600_voice_storage_undeclare rendered plan_revision's and device_agent_request's triggers without them.
ALTER TABLE "plan_revision" DROP COLUMN IF EXISTS "live_session_id";--> statement-breakpoint
ALTER TABLE "device_agent_request" DROP COLUMN IF EXISTS "exit_code";--> statement-breakpoint
ALTER TABLE "device_agent_request" DROP COLUMN IF EXISTS "stdout";--> statement-breakpoint
ALTER TABLE "device_agent_request" DROP COLUMN IF EXISTS "stderr";--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN IF EXISTS "plan_template";--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN IF EXISTS "voice";--> statement-breakpoint
DROP TABLE IF EXISTS "account_plan_template_revision";--> statement-breakpoint
DROP TABLE IF EXISTS "task_board";--> statement-breakpoint
DROP TABLE IF EXISTS "task_issue";--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_integration_connection";--> statement-breakpoint
-- A call's avatar and transcript reference the call, so both go before it.
DROP TABLE IF EXISTS "voice_avatar_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "voice_transcript_segments";--> statement-breakpoint
DROP TABLE IF EXISTS "voice_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "voice_session_usage";
