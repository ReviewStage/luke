ALTER TABLE "coding_agent" ADD COLUMN IF NOT EXISTS "runner_token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coding_agent_runner_token_hash" ON "coding_agent" ("runner_token_hash") WHERE "runner_token_hash" is not null;--> statement-breakpoint
-- The digest a runner holds now moves with it to its agent's row; the conversation's column is left for a later cleanup.
UPDATE "coding_agent" SET "runner_token_hash" = "conversations"."runner_token_hash"
FROM "conversations"
WHERE "conversations"."id" = "coding_agent"."conversation_id"
  AND "conversations"."runner_token_hash" IS NOT NULL
  AND "coding_agent"."runner_token_hash" IS NULL;
