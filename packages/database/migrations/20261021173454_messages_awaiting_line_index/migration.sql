-- The migrator runs every folder inside one transaction, so CONCURRENTLY is unavailable here.
-- Measured on Neon's default branch on 2026-10-21 17:15 UTC: messages held 27,297 rows in a 21 MB
-- heap (2,710 blocks; its parts are TOASTed apart), and the scan and sort the build does over it read
-- in 7 ms, so the build holds the table's write lock for milliseconds and needs no online step before the deploy.
CREATE INDEX IF NOT EXISTS "messages_awaiting_line" ON "messages" ("conversation_id","seq") WHERE ("role" = 'user' and "turn_id" is null);
