-- contract: nothing has declared, read, or written "channel", "channel_look", or "inbox_item"."channel_id" since 20261103135944_channel_undeclare, which already dropped their capture and the key from "inbox_item" to "channel", and no synced table's capture names them
-- Dropping the trigger and the column takes an ACCESS EXCLUSIVE lock on "inbox_item", and dropping the tables drops
-- their foreign keys, and with them the triggers those keys keep on "organization" and "user". All three are written by
-- live traffic, so they are locked first, as 20261030235709_host_install_token_drop locks its table, after GitLab's
-- with_lock_retries
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
			LOCK TABLE "inbox_item", "organization", "user" IN ACCESS EXCLUSIVE MODE;
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
-- The trigger goes first: its WHEN names "channel_id", and its function writes "channel".
DROP TRIGGER IF EXISTS "inbox_item_general_channel" ON "inbox_item";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "inbox_item_general_channel"();
--> statement-breakpoint
DROP INDEX IF EXISTS "inbox_item_channel_updated";
--> statement-breakpoint
DROP INDEX IF EXISTS "inbox_item_channel_posted";
--> statement-breakpoint
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "channel_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "channel_look";
--> statement-breakpoint
DROP TABLE IF EXISTS "channel";
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
