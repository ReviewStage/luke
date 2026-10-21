-- The migrator runs every folder inside one transaction, so CONCURRENTLY is unavailable here.
-- Measured on the luke project's default branch 2026-10-21 17:10 UTC: coding_agent 975 rows (15 MB),
-- each on its own conversation, so the build holds the table's write lock for milliseconds, needs
-- no online step before the deploy, and finds no duplicate to refuse.
CREATE UNIQUE INDEX IF NOT EXISTS "coding_agent_conversation" ON "coding_agent" ("conversation_id");
