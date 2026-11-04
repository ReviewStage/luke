-- Contract step of dropping the device's "isolation", "kind", and "signed_in": nothing has declared, read, or
-- written them since 20261104191235_device_isolation_kind_signed_in_undeclare (#6795), and the device's capture
-- (20261104051306_sync_device_hosts) watches none of them, so no trigger names them. The device is written on every
-- beat of every host, so it is locked first, as 20261030230152_agent_state_drop locks it: each attempt under a
-- short lock_timeout of its own, letting the lock go and backing off holding none between attempts.
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
			LOCK TABLE "device" IN ACCESS EXCLUSIVE MODE;
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
ALTER TABLE "device" DROP COLUMN IF EXISTS "isolation";
--> statement-breakpoint
ALTER TABLE "device" DROP COLUMN IF EXISTS "kind";
--> statement-breakpoint
ALTER TABLE "device" DROP COLUMN IF EXISTS "signed_in";
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
