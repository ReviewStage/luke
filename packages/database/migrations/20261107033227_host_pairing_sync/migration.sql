-- Captures "host_pairing" for Vespin Sync, so a box collecting its secret, which deletes its pairing, wakes
-- the account's hosts read (`hostsRead`). Dropping and creating its triggers locks the table that every start and
-- poll writes, so it is locked first: each attempt under a short lock_timeout of its own, letting the lock go and
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
			LOCK TABLE "host_pairing" IN ACCESS EXCLUSIVE MODE;
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
DROP TRIGGER IF EXISTS "app_sync_update" ON "host_pairing";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "host_pairing";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_host_pairing"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
	END IF;
	FOR sync_topic IN
		SELECT DISTINCT "value" FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL ORDER BY "value"
	LOOP
		IF sync_batch <> '' AND octet_length('{"t":[' || sync_batch || ',' || sync_topic::text || '],"x":"' || sync_txid || '"}') >= 8000 THEN
			PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
			sync_batch := '';
		END IF;
		sync_batch := CASE WHEN sync_batch = '' THEN sync_topic::text ELSE sync_batch || ',' || sync_topic::text END;
	END LOOP;
	IF sync_batch <> '' THEN
		PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
	END IF;
	RETURN NULL;
END
$app_sync$;
--> statement-breakpoint
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "host_pairing" FOR EACH ROW EXECUTE FUNCTION "app_sync_host_pairing"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "host_pairing" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."device_id" IS DISTINCT FROM NEW."device_id") EXECUTE FUNCTION "app_sync_host_pairing"();
--> statement-breakpoint
-- Note that the settings go back with SET LOCAL rather than RESET, because RESET sets the session's value to the
-- server's default, which outlives this transaction and takes away the runner's own lock_timeout (migrator.ts's
-- MIGRATION_LOCK_TIMEOUT) from every later migration of the run. The 5s above is that bound already, so it stands.
SET LOCAL statement_timeout TO DEFAULT;
