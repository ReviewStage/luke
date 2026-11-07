-- Contract step of dropping the token agents' pull request polls: nothing has declared, read, or written
-- "token_pull_request_poll" since 20261106223140_token_pull_request_poll_undeclare (#7354), which removed the sweep
-- that claimed its rows, and no synced table's capture names it. Dropping it drops its foreign key to "agent", and
-- with it the triggers that key keeps on "agent", which is written on every turn of an agent, so "agent" is locked
-- first, as 20261105152259_agent_drop_repositories locks it, after GitLab's with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- under a short lock_timeout of its own, letting the lock go and backing off holding none between attempts.
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
			LOCK TABLE "agent", "token_pull_request_poll" IN ACCESS EXCLUSIVE MODE;
			RETURN;
		EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
			IF clock_timestamp() > deadline THEN
				RAISE;
			END IF;
		WHEN undefined_table THEN
			-- A database that never had the table has nothing to lock it for.
			RETURN;
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
DROP TABLE IF EXISTS "token_pull_request_poll";
--> statement-breakpoint
-- Note that the settings go back with SET LOCAL rather than RESET, because RESET sets the session's value to the
-- server's default, which outlives this transaction and takes away the runner's own lock_timeout (migrator.ts's
-- MIGRATION_LOCK_TIMEOUT) from every later migration of the run. The 5s above is that bound already, so it stands.
SET LOCAL statement_timeout TO DEFAULT;
