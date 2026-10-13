DROP TABLE IF EXISTS "account_workspace_preference" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "devices" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "introduction_usage" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "observation_pass" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "provider_cursors" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "provider_key" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "roster_snapshot" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "transcript_mark" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_embedding" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_file" CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_observed_session";--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_undelivered_children";--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN IF EXISTS "default_workspace_provider";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "provider_id";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "provider_session_id";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "workspace";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "spawned_by_message_id";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "next_event_seq";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "memory_flush_operation_id";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "memory_flush_outcome";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "memory_flushed_at";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "completion_delivered_at";--> statement-breakpoint
DROP SCHEMA IF EXISTS "drizzle" CASCADE;
