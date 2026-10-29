-- A task's parent, so tasks nest to any depth: a column, its index, and the task table's capture
-- rendered over it. Every change here is additive. The task table is written on every save of a
-- plan, so it is locked first, as 20261029021951_agent_tables_rename locks its own, after GitLab's
-- with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- under a short lock_timeout of its own, letting the lock go and backing off holding none between
-- attempts. Nothing else this migration does locks a table but this one.
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
DROP TRIGGER IF EXISTS "luke_sync_update" ON "task";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "task";
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
CREATE INDEX "task_parent" ON "task" ("parent_task_id") WHERE "parent_task_id" is not null;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_task_id_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "task"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_not_self" CHECK ("parent_task_id" <> "id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_task"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "task" FOR EACH ROW EXECUTE FUNCTION "luke_sync_task"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "task" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."number" IS DISTINCT FROM NEW."number" OR OLD."parent_task_id" IS DISTINCT FROM NEW."parent_task_id" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."priority" IS DISTINCT FROM NEW."priority" OR OLD."assignee_id" IS DISTINCT FROM NEW."assignee_id" OR OLD."creator_actor" IS DISTINCT FROM NEW."creator_actor" OR OLD."creator_agent_id" IS DISTINCT FROM NEW."creator_agent_id" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."brief" IS DISTINCT FROM NEW."brief" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at" OR OLD."completed_at" IS DISTINCT FROM NEW."completed_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "luke_sync_task"();
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
