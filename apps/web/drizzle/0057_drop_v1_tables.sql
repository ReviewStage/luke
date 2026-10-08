DELETE FROM "conversations" WHERE "kind" <> 'plan';--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_observed_session";--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_standing_main";--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_undelivered_children";--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_user_kind";--> statement-breakpoint
ALTER TABLE "conversations"
  DROP COLUMN IF EXISTS "provider_id",
  DROP COLUMN IF EXISTS "provider_session_id",
  DROP COLUMN IF EXISTS "title",
  DROP COLUMN IF EXISTS "workspace",
  DROP COLUMN IF EXISTS "parent_conversation_id",
  DROP COLUMN IF EXISTS "spawned_by_message_id",
  DROP COLUMN IF EXISTS "next_event_seq",
  DROP COLUMN IF EXISTS "memory_flush_operation_id",
  DROP COLUMN IF EXISTS "memory_flush_outcome",
  DROP COLUMN IF EXISTS "memory_flushed_at",
  DROP COLUMN IF EXISTS "label",
  DROP COLUMN IF EXISTS "completion_delivered_at",
  DROP COLUMN IF EXISTS "expects_completion";--> statement-breakpoint
ALTER TABLE "voice_sessions" DROP COLUMN IF EXISTS "device_id";--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN IF EXISTS "default_workspace_provider";--> statement-breakpoint
DROP TABLE IF EXISTS "events";--> statement-breakpoint
DROP TABLE IF EXISTS "provider_cursors";--> statement-breakpoint
DROP TABLE IF EXISTS "devices";--> statement-breakpoint
DROP TABLE IF EXISTS "roster_snapshot";--> statement-breakpoint
DROP TABLE IF EXISTS "transcript_mark";--> statement-breakpoint
DROP TABLE IF EXISTS "observation_pass";--> statement-breakpoint
DROP TABLE IF EXISTS "provider_key";--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_file";--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_embedding";--> statement-breakpoint
DROP TABLE IF EXISTS "introduction_usage";--> statement-breakpoint
DROP TABLE IF EXISTS "account_workspace_preference";--> statement-breakpoint
DELETE FROM "oauth_access_token" WHERE "client_id" = 'luke-mobile';--> statement-breakpoint
DELETE FROM "oauth_refresh_token" WHERE "client_id" = 'luke-mobile';--> statement-breakpoint
DELETE FROM "oauth_consent" WHERE "client_id" = 'luke-mobile';--> statement-breakpoint
DELETE FROM "oauth_client" WHERE "client_id" = 'luke-mobile';
