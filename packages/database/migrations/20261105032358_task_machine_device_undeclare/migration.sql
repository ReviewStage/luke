-- Expand step of dropping the task's "machine" and "device_id": the modules no longer declare them, and
-- nothing this deployment runs reads or writes them, as nothing has since #6892. Note that the columns
-- themselves, and "device_id"'s foreign key to "device", stay one deployment longer, because a build
-- migrates while the deployment before it still serves and Drizzle names every declared column in an
-- insert; a later release's migration drops them (apps/web/server/README.md, "Dropping a column ... takes
-- two deployments"). Both have a default, so this deployment's inserts, which name them no longer, still
-- succeed while they stand. The task table's capture is rendered again without them, since a trigger whose
-- WHEN names a column is what a later DROP COLUMN would refuse over. The task table is written on every
-- save of a plan, so it is locked first, as 20261030152822_pilot_switches_undeclare locks it, after
-- GitLab's with_lock_retries
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
DROP TRIGGER IF EXISTS "app_sync_update" ON "task";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'task',
		(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),
		coalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "task" FOR EACH ROW EXECUTE FUNCTION "app_sync_task"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."number" IS DISTINCT FROM NEW."number" OR OLD."parent_task_id" IS DISTINCT FROM NEW."parent_task_id" OR OLD."mode" IS DISTINCT FROM NEW."mode" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."priority" IS DISTINCT FROM NEW."priority" OR OLD."assignee_id" IS DISTINCT FROM NEW."assignee_id" OR OLD."creator_actor" IS DISTINCT FROM NEW."creator_actor" OR OLD."creator_agent_id" IS DISTINCT FROM NEW."creator_agent_id" OR OLD."made_by_start" IS DISTINCT FROM NEW."made_by_start" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."brief" IS DISTINCT FROM NEW."brief" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at" OR OLD."completed_at" IS DISTINCT FROM NEW."completed_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_task"();
