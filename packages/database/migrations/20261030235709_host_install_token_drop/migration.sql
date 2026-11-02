-- Contract step of dropping the install tokens hosts once enrolled with: nothing has declared, read, or written
-- "host_install_token" since 20261030233515_host_install_token_undeclare (#6160), and no synced table's capture names
-- it. Dropping the table drops its foreign key, and with it the triggers that key keeps on the table it references,
-- "user", which takes an ACCESS EXCLUSIVE lock on it. That table is read and written by live traffic, so it is locked
-- first, as 20261030230152_agent_state_drop locks its tables, after GitLab's with_lock_retries
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
			LOCK TABLE "user" IN ACCESS EXCLUSIVE MODE;
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
DROP TABLE IF EXISTS "host_install_token";
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
