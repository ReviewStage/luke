-- Contract step of dropping the queue of sessions whose sandboxes the scheduled sweep deleted: nothing has declared,
-- read, or written "session_sandbox_cleanup" since 20261107005733_session_sandbox_cleanup_undeclare (#7437), which
-- removed the sweep and every write to the queue, and that release is the one serving. The table names no other
-- table and no other table names it, so the drop locks it alone; it is still locked first, as
-- 20261105152259_agent_drop_repositories locks "agent", under a short lock_timeout of its own, letting the lock go
-- and backing off holding none between attempts, so a drop never queues live traffic behind it.
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
			LOCK TABLE "session_sandbox_cleanup" IN ACCESS EXCLUSIVE MODE;
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
DROP TABLE IF EXISTS "session_sandbox_cleanup";
--> statement-breakpoint
-- Note that the settings go back with SET LOCAL rather than RESET, because RESET sets the session's value to the
-- server's default, which outlives this transaction and takes away the runner's own lock_timeout (migrator.ts's
-- MIGRATION_LOCK_TIMEOUT) from every later migration of the run. The 5s above is that bound already, so it stands.
SET LOCAL statement_timeout TO DEFAULT;
