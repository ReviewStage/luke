-- Contract step of dropping the conversation's "deleted_at": nothing has read or written it since a deleted
-- task's or agent's conversations became deleted at once, nor declared it since
-- 20261107012718_conversation_deleted_at_undeclare (#7468), and that migration rendered the conversations
-- capture without it, so no trigger names it. The rows a deployment before that one stamped while it still
-- served are deleted first, their messages, turns, events, and workers by the schema's cascade, since nothing
-- reads past a stamp any more. "conversations_standing_main" named the column in its predicate, and a DROP
-- COLUMN drops an index that names it, so it is declared again without it before the column goes, in this
-- same transaction under the lock below, so no write lands while no index refuses a second standing main.
-- "conversations_deleted_at" goes with the column. The conversations table is written on every turn, so it
-- is locked first, as 20261105152259_agent_drop_repositories locks its table, after GitLab's with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- each attempt under a short lock_timeout of its own, letting the lock go and backing off holding none between
-- attempts. The table holds a few thousand rows, so building the index under the lock takes milliseconds.
SET LOCAL statement_timeout = '150s';
--> statement-breakpoint
DO $$
DECLARE
	attempt int := 0;
	deadline timestamptz := clock_timestamp() + interval '2 minutes';
BEGIN
	LOOP
		attempt := attempt + 1;
		BEGIN
			PERFORM set_config('lock_timeout', least(100 * attempt, 500) || 'ms', true);
			LOCK TABLE "conversations" IN ACCESS EXCLUSIVE MODE;
			RETURN;
		EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
			IF clock_timestamp() > deadline THEN
				RAISE;
			END IF;
		END;
		PERFORM pg_sleep(least(0.2 * attempt, 3) * (0.5 + random()));
	END LOOP;
END
$$;
--> statement-breakpoint
-- With the lock held, no statement below waits on another; one that does gives up rather than
-- queueing live traffic behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'deleted_at'
	) THEN
		DELETE FROM "conversations" WHERE "deleted_at" IS NOT NULL;
	END IF;
END
$$;
--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_standing_main";
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_standing_main" ON "conversations" ("user_id") WHERE "kind" = 'main';
--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "deleted_at";
--> statement-breakpoint
-- Note that the settings go back with SET LOCAL rather than RESET, because RESET sets the session's value to the
-- server's default, which outlives this transaction and takes away the runner's own lock_timeout (migrator.ts's
-- MIGRATION_LOCK_TIMEOUT) from every later migration of the run. The 5s above is that bound already, so it stands.
SET LOCAL statement_timeout TO DEFAULT;
