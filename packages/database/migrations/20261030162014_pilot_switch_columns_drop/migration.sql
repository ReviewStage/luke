-- Contract step of dropping a pilot tree's switches: nothing has declared, read, or written "task"."merge_policy",
-- "task"."running", or "turns"."cancel_requested_for_running" since 20261030152822_pilot_switches_undeclare (#6054),
-- and that migration rendered the task and turns capture without them, so no trigger names them. Both tables are
-- written on every turn and every save of a plan, so they are locked first, as that migration locks them, after
-- GitLab's with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- under a short lock_timeout of its own, letting the locks go and backing off holding none between attempts.
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
			LOCK TABLE "task", "turns" IN ACCESS EXCLUSIVE MODE;
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
-- With the locks held, no statement below waits on another; one that does gives up rather than
-- queueing live traffic behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "merge_policy";
--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "running";
--> statement-breakpoint
ALTER TABLE "turns" DROP COLUMN IF EXISTS "cancel_requested_for_running";
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
