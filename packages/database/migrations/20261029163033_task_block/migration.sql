-- One task blocking another: a new table, synced, holding two foreign keys to `task`. A new foreign
-- key locks the table it names against writes, and `task` is written on every save of a plan, so it
-- is locked first, as 20261029023436_agent_columns_expand locks `agent`, after GitLab's
-- with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- under a short lock_timeout of its own, letting the lock go and backing off holding none between
-- attempts. Nothing else this migration does locks a table that stands but this one.
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
			LOCK TABLE "task" IN SHARE ROW EXCLUSIVE MODE;
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
DROP TRIGGER IF EXISTS "luke_sync_update" ON "task_block";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "task_block";
--> statement-breakpoint
CREATE TABLE "task_block" (
	"blocker_task_id" uuid,
	"blocked_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_block_pkey" PRIMARY KEY("blocked_task_id","blocker_task_id"),
	CONSTRAINT "task_block_not_self" CHECK ("blocker_task_id" <> "blocked_task_id")
);
--> statement-breakpoint
CREATE INDEX "task_block_blocker" ON "task_block" ("blocker_task_id");--> statement-breakpoint
ALTER TABLE "task_block" ADD CONSTRAINT "task_block_blocker_task_id_task_id_fkey" FOREIGN KEY ("blocker_task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_block" ADD CONSTRAINT "task_block_blocked_task_id_task_id_fkey" FOREIGN KEY ("blocked_task_id") REFERENCES "task"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_task_block"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."blocker_task_id"::text), jsonb_build_array('task', OLD."blocked_task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "task"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "task"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "task"."id" = OLD."blocker_task_id"
		), '[]');
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "task"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "task"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "task"."id" = OLD."blocked_task_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."blocker_task_id"::text), jsonb_build_array('task', NEW."blocked_task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "task"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "task"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "task"."id" = NEW."blocker_task_id"
		), '[]');
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "task"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "task"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "task"."id" = NEW."blocked_task_id"
		), '[]');
	END IF;
	FOR sync_topic IN
		SELECT DISTINCT "value" FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL ORDER BY "value"
	LOOP
		IF sync_batch <> '' AND octet_length('{"t":[' || sync_batch || ',' || sync_topic::text || '],"x":"' || sync_txid || '"}') >= 8000 THEN
			PERFORM pg_notify('luke_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
			sync_batch := '';
		END IF;
		sync_batch := CASE WHEN sync_batch = '' THEN sync_topic::text ELSE sync_batch || ',' || sync_topic::text END;
	END LOOP;
	IF sync_batch <> '' THEN
		PERFORM pg_notify('luke_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
	END IF;
	RETURN NULL;
END
$luke_sync$;
--> statement-breakpoint
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "task_block" FOR EACH ROW EXECUTE FUNCTION "luke_sync_task_block"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "task_block" FOR EACH ROW WHEN (OLD."blocker_task_id" IS DISTINCT FROM NEW."blocker_task_id" OR OLD."blocked_task_id" IS DISTINCT FROM NEW."blocked_task_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "luke_sync_task_block"();
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
