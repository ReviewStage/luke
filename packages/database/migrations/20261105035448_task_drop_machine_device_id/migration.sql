-- Contract step of dropping the task's "machine" and "device_id": nothing has read or written them since #6892,
-- nor declared them since 20261105032358_task_machine_device_undeclare (#6897), and that migration rendered the
-- task's capture without them, so no trigger names them. Dropping "device_id" takes its foreign key to "device"
-- ("task_device_id_device_id_fkey") with it. The task table is written on every save of a plan, so it is locked
-- first, as that migration locks it: each attempt under a short lock_timeout of its own, letting the lock go and
-- backing off holding none between attempts.
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
			LOCK TABLE "task" IN ACCESS EXCLUSIVE MODE;
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
ALTER TABLE "task" DROP COLUMN IF EXISTS "machine";
--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "device_id";
--> statement-breakpoint
-- Note that the settings go back with SET LOCAL rather than RESET, because RESET sets the session's value to the
-- server's default, which outlives this transaction and takes away the runner's own lock_timeout (migrator.ts's
-- MIGRATION_LOCK_TIMEOUT) from every later migration of the run. The 5s above is that bound already, so it stands.
SET LOCAL statement_timeout TO DEFAULT;
