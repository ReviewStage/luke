-- Contract step of dropping a device agent's saved state: nothing has declared, read, or written
-- "agent_state_generation", "agent_state_key", or "agent_state_upload" since 20261030223850_agent_state_undeclare
-- (#6151), and no synced table's capture names them. Dropping a table drops its foreign keys, and with them the
-- triggers those keys keep on the tables they reference, "device" and "agent", which takes an ACCESS EXCLUSIVE
-- lock on each. Both are written by live traffic, so they are locked first, as 20261030162014_pilot_switch_columns_drop
-- locks its tables, after GitLab's with_lock_retries
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
			LOCK TABLE "device", "agent" IN ACCESS EXCLUSIVE MODE;
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
DROP TABLE IF EXISTS "agent_state_generation";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_state_key";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_state_upload";
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
