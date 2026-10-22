DROP INDEX IF EXISTS "conversations_runner_token_hash";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "runner_token_hash";
