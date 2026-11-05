-- Read marks move to the service: two tables of each member's marks, and a "read_through" on the task and
-- the agent, both rows written on every save of a plan and every turn of an agent, so both are locked first,
-- as 20261105032358_task_machine_device_undeclare locks the task, after GitLab's with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- under a short lock_timeout of its own, letting the locks go and backing off holding none between attempts.
-- The task is locked before the agent, the order a task's own writes take them in.
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
			LOCK TABLE "task", "agent" IN ACCESS EXCLUSIVE MODE;
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
DROP TRIGGER IF EXISTS "app_sync_update" ON "task_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "task";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent";
--> statement-breakpoint
CREATE TABLE "agent_read" (
	"user_id" text,
	"agent_id" uuid,
	"read_through" timestamp with time zone,
	"marked_unread" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agent_read_pkey" PRIMARY KEY("user_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "task_read" (
	"user_id" text,
	"task_id" uuid,
	"read_through" timestamp with time zone,
	"marked_unread" boolean DEFAULT false NOT NULL,
	CONSTRAINT "task_read_pkey" PRIMARY KEY("user_id","task_id")
);
--> statement-breakpoint
-- No backfill: `now()` is stable, so each default is evaluated once and kept in the catalog as the value of every row standing, with no row rewritten. Every task and agent that stands when read marks move to the service reads as read through that instant, for every member, until it changes again.
ALTER TABLE "agent" ADD COLUMN "read_through" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "read_through" timestamp with time zone DEFAULT now();--> statement-breakpoint
-- The defaults are dropped in the same transaction, so a task or agent started from here on holds null and reads through its start. The standing rows keep the value the catalog stamped them with.
ALTER TABLE "agent" ALTER COLUMN "read_through" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "read_through" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "agent_read_agent" ON "agent_read" ("agent_id");--> statement-breakpoint
CREATE INDEX "task_read_task" ON "task_read" ("task_id");--> statement-breakpoint
ALTER TABLE "agent_read" ADD CONSTRAINT "agent_read_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_read" ADD CONSTRAINT "agent_read_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_read" ADD CONSTRAINT "task_read_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_read" ADD CONSTRAINT "task_read_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task_read"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('user_id', OLD."user_id", 'task_id', OLD."task_id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('user_id', NEW."user_id", 'task_id', NEW."task_id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'task_read',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "task_read" FOR EACH ROW EXECUTE FUNCTION "app_sync_task_read"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task_read" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."marked_unread" IS DISTINCT FROM NEW."marked_unread") EXECUTE FUNCTION "app_sync_task_read"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_read"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('user_id', OLD."user_id", 'agent_id', OLD."agent_id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('user_id', NEW."user_id", 'agent_id', NEW."agent_id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'agent_read',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_read" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_read"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_read" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."marked_unread" IS DISTINCT FROM NEW."marked_unread") EXECUTE FUNCTION "app_sync_agent_read"();
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
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."number" IS DISTINCT FROM NEW."number" OR OLD."parent_task_id" IS DISTINCT FROM NEW."parent_task_id" OR OLD."mode" IS DISTINCT FROM NEW."mode" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."priority" IS DISTINCT FROM NEW."priority" OR OLD."assignee_id" IS DISTINCT FROM NEW."assignee_id" OR OLD."creator_actor" IS DISTINCT FROM NEW."creator_actor" OR OLD."creator_agent_id" IS DISTINCT FROM NEW."creator_agent_id" OR OLD."made_by_start" IS DISTINCT FROM NEW."made_by_start" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."brief" IS DISTINCT FROM NEW."brief" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at" OR OLD."completed_at" IS DISTINCT FROM NEW."completed_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at" OR OLD."read_through" IS DISTINCT FROM NEW."read_through") EXECUTE FUNCTION "app_sync_task"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."id"::text), jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."id"::text), jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'agent',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."automation_run_id" IS DISTINCT FROM NEW."automation_run_id" OR OLD."automation_origin" IS DISTINCT FROM NEW."automation_origin" OR OLD."started_from" IS DISTINCT FROM NEW."started_from" OR OLD."source" IS DISTINCT FROM NEW."source" OR OLD."started_by_agent_id" IS DISTINCT FROM NEW."started_by_agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort" OR OLD."context_window" IS DISTINCT FROM NEW."context_window" OR OLD."plan_snapshot" IS DISTINCT FROM NEW."plan_snapshot" OR OLD."prompt" IS DISTINCT FROM NEW."prompt" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."branch" IS DISTINCT FROM NEW."branch" OR OLD."start_branch" IS DISTINCT FROM NEW."start_branch" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."compacted_at" IS DISTINCT FROM NEW."compacted_at" OR OLD."published" IS DISTINCT FROM NEW."published" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at" OR OLD."archived_by" IS DISTINCT FROM NEW."archived_by" OR OLD."disabled_servers" IS DISTINCT FROM NEW."disabled_servers" OR OLD."mentioned_servers" IS DISTINCT FROM NEW."mentioned_servers" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."payer" IS DISTINCT FROM NEW."payer" OR OLD."runner_token_hash" IS DISTINCT FROM NEW."runner_token_hash" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."read_through" IS DISTINCT FROM NEW."read_through") EXECUTE FUNCTION "app_sync_agent"();
