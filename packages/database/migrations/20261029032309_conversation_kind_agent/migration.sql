-- An agent's conversation is stored as `agent` where it said `coding_agent`. The release before this
-- one reads both spellings, so a row rewritten here stays its agent's.
--
-- Note that the rewrite is one pass that never waits on a row: `conversations` is written on every
-- turn, and this runs inside the deploy's one migration transaction, so a row it rewrote stays
-- locked until that commits. A row a live transaction holds is skipped and keeps `coding_agent`,
-- which every reader still takes, as does a row the release before this one writes while it
-- serves; the migration that drops the old spelling rewrites both. Running it again finds only
-- those.
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
UPDATE "conversations" SET "kind" = 'agent'
WHERE "id" IN (SELECT "id" FROM "conversations" WHERE "kind" = 'coding_agent' FOR UPDATE SKIP LOCKED);
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
