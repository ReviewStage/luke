-- The renamed tables' locks, and the three whose columns are renamed, are taken as
-- 20261029021951_agent_tables_rename takes them: one LOCK in a fixed order under a short
-- lock_timeout, retried with a growing backoff holding none, so a live transaction is never the one
-- a deadlock aborts. Note that the release before this one still names the old tables and columns
-- for the minute a deploy takes, and its requests fail meanwhile, which a straight cutover accepts.
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
			LOCK TABLE "agent", "attachment", "turns", "plan_comment_thread", "plan_comment", "plan_revision", "plan_page_version" IN ACCESS EXCLUSIVE MODE;
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
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
-- The capture's triggers are dropped under their tables' old names before the renames, so a
-- column a trigger's WHEN names can be renamed, and rendered afresh under the new names below.
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_comment_thread";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_comment_thread";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_comment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_comment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_page_version";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_page_version";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "turns";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "turns";
--> statement-breakpoint
ALTER TABLE "plan_comment" RENAME TO "description_comment";--> statement-breakpoint
ALTER TABLE "plan_comment_thread" RENAME TO "description_comment_thread";--> statement-breakpoint
ALTER TABLE "plan_revision" RENAME TO "description_revision";--> statement-breakpoint
ALTER TABLE "plan_page_version" RENAME TO "task_page_version";--> statement-breakpoint
ALTER TABLE "agent" RENAME COLUMN "plan_snapshot" TO "description_snapshot";--> statement-breakpoint
ALTER TABLE "attachment" RENAME COLUMN "plan_comment_id" TO "description_comment_id";--> statement-breakpoint
ALTER TABLE "turns" RENAME COLUMN "plan_notes_taken" TO "description_notes_taken";--> statement-breakpoint
ALTER TABLE "attachment" RENAME CONSTRAINT "attachment_plan_comment_file" TO "attachment_description_comment_file";--> statement-breakpoint
ALTER TABLE "description_comment_thread" RENAME CONSTRAINT "plan_comment_thread_page" TO "description_comment_thread_page";--> statement-breakpoint
ALTER TABLE "task_page_version" RENAME CONSTRAINT "plan_page_version_owner" TO "task_page_version_owner";--> statement-breakpoint
ALTER INDEX "attachment_plan_comment" RENAME TO "attachment_description_comment";--> statement-breakpoint
ALTER INDEX "plan_comment_thread_seq" RENAME TO "description_comment_thread_seq";--> statement-breakpoint
ALTER INDEX "plan_comment_task" RENAME TO "description_comment_task";--> statement-breakpoint
ALTER INDEX "plan_comment_client_key" RENAME TO "description_comment_client_key";--> statement-breakpoint
ALTER INDEX "plan_comment_thread_task_created" RENAME TO "description_comment_thread_task_created";--> statement-breakpoint
ALTER INDEX "plan_page_version_task" RENAME TO "task_page_version_task";--> statement-breakpoint
ALTER INDEX "plan_page_version_agent" RENAME TO "task_page_version_agent";--> statement-breakpoint
ALTER TABLE "task_page_version" RENAME CONSTRAINT "plan_page_version_page_version" TO "task_page_version_page_version";
--> statement-breakpoint
-- The old tables' capture functions, whose triggers were dropped above, go with their names.
DROP FUNCTION "app_sync_plan_comment_thread"();
--> statement-breakpoint
DROP FUNCTION "app_sync_plan_comment"();
--> statement-breakpoint
DROP FUNCTION "app_sync_plan_revision"();
--> statement-breakpoint
DROP FUNCTION "app_sync_plan_page_version"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_description_comment_thread"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "description_comment_thread" FOR EACH ROW EXECUTE FUNCTION "app_sync_description_comment_thread"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "description_comment_thread" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."quote" IS DISTINCT FROM NEW."quote" OR OLD."anchor_from" IS DISTINCT FROM NEW."anchor_from" OR OLD."anchor_to" IS DISTINCT FROM NEW."anchor_to" OR OLD."section" IS DISTINCT FROM NEW."section" OR OLD."page_id" IS DISTINCT FROM NEW."page_id" OR OLD."page_version" IS DISTINCT FROM NEW."page_version" OR OLD."page_element" IS DISTINCT FROM NEW."page_element" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_description_comment_thread"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_description_comment"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "description_comment" FOR EACH ROW EXECUTE FUNCTION "app_sync_description_comment"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "description_comment" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."thread_id" IS DISTINCT FROM NEW."thread_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."actor" IS DISTINCT FROM NEW."actor" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."words" IS DISTINCT FROM NEW."words" OR OLD."asked_actor" IS DISTINCT FROM NEW."asked_actor" OR OLD."asked_agent_id" IS DISTINCT FROM NEW."asked_agent_id" OR OLD."client_key" IS DISTINCT FROM NEW."client_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."edited_at" IS DISTINCT FROM NEW."edited_at") EXECUTE FUNCTION "app_sync_description_comment"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_description_revision"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "description_revision" FOR EACH ROW EXECUTE FUNCTION "app_sync_description_revision"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "description_revision" FOR EACH ROW WHEN (OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."actor" IS DISTINCT FROM NEW."actor" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."changes" IS DISTINCT FROM NEW."changes" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."at" IS DISTINCT FROM NEW."at" OR OLD."restored_from" IS DISTINCT FROM NEW."restored_from") EXECUTE FUNCTION "app_sync_description_revision"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task_page_version"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('agent', OLD."agent_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('agent', NEW."agent_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "task_page_version" FOR EACH ROW EXECUTE FUNCTION "app_sync_task_page_version"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task_page_version" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."page_id" IS DISTINCT FROM NEW."page_id" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."html" IS DISTINCT FROM NEW."html" OR OLD."shown_by" IS DISTINCT FROM NEW."shown_by" OR OLD."at" IS DISTINCT FROM NEW."at") EXECUTE FUNCTION "app_sync_task_page_version"();
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
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."automation_run_id" IS DISTINCT FROM NEW."automation_run_id" OR OLD."automation_origin" IS DISTINCT FROM NEW."automation_origin" OR OLD."started_from" IS DISTINCT FROM NEW."started_from" OR OLD."source" IS DISTINCT FROM NEW."source" OR OLD."started_by_agent_id" IS DISTINCT FROM NEW."started_by_agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort" OR OLD."context_window" IS DISTINCT FROM NEW."context_window" OR OLD."description_snapshot" IS DISTINCT FROM NEW."description_snapshot" OR OLD."prompt" IS DISTINCT FROM NEW."prompt" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."branch" IS DISTINCT FROM NEW."branch" OR OLD."start_branch" IS DISTINCT FROM NEW."start_branch" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."compacted_at" IS DISTINCT FROM NEW."compacted_at" OR OLD."published" IS DISTINCT FROM NEW."published" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at" OR OLD."archived_by" IS DISTINCT FROM NEW."archived_by" OR OLD."disabled_servers" IS DISTINCT FROM NEW."disabled_servers" OR OLD."mentioned_servers" IS DISTINCT FROM NEW."mentioned_servers" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."payer" IS DISTINCT FROM NEW."payer" OR OLD."runner_token_hash" IS DISTINCT FROM NEW."runner_token_hash" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."read_through" IS DISTINCT FROM NEW."read_through") EXECUTE FUNCTION "app_sync_agent"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_attachment"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."inbox_item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."inbox_item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'attachment',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "attachment" FOR EACH ROW EXECUTE FUNCTION "app_sync_attachment"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "attachment" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."inbox_item_id" IS DISTINCT FROM NEW."inbox_item_id" OR OLD."inbox_message_id" IS DISTINCT FROM NEW."inbox_message_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."description_comment_id" IS DISTINCT FROM NEW."description_comment_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."content_type" IS DISTINCT FROM NEW."content_type" OR OLD."sha256" IS DISTINCT FROM NEW."sha256" OR OLD."width" IS DISTINCT FROM NEW."width" OR OLD."height" IS DISTINCT FROM NEW."height" OR OLD."byte_count" IS DISTINCT FROM NEW."byte_count" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."saved_at" IS DISTINCT FROM NEW."saved_at") EXECUTE FUNCTION "app_sync_attachment"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_turns"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "agent"."id"::text)), (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."conversation_id" = OLD."conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "agent"."id"::text)), (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."conversation_id" = NEW."conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'turns',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "turns" FOR EACH ROW EXECUTE FUNCTION "app_sync_turns"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "turns" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."origin" IS DISTINCT FROM NEW."origin" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."reasoning_effort" IS DISTINCT FROM NEW."reasoning_effort" OR OLD."prompt_hash" IS DISTINCT FROM NEW."prompt_hash" OR OLD."tool_set_hash" IS DISTINCT FROM NEW."tool_set_hash" OR OLD."response_ids" IS DISTINCT FROM NEW."response_ids" OR OLD."usage" IS DISTINCT FROM NEW."usage" OR OLD."eve_turn_id" IS DISTINCT FROM NEW."eve_turn_id" OR OLD."queued_at" IS DISTINCT FROM NEW."queued_at" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."failure" IS DISTINCT FROM NEW."failure" OR OLD."failure_detail" IS DISTINCT FROM NEW."failure_detail" OR OLD."cancel_requested_at" IS DISTINCT FROM NEW."cancel_requested_at" OR OLD."cancel_request_key" IS DISTINCT FROM NEW."cancel_request_key" OR OLD."cancel_requested_by" IS DISTINCT FROM NEW."cancel_requested_by" OR OLD."fast_refused" IS DISTINCT FROM NEW."fast_refused") EXECUTE FUNCTION "app_sync_turns"();

--> statement-breakpoint
-- A page of an agent on no task goes with the agent (20261021205954_plan_page_version_agent); its
-- trigger's function names the table in its body, which a rename does not rewrite, so it is made
-- again under the table's new name and the old one dropped.
CREATE OR REPLACE FUNCTION "task_page_version_agent_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	DELETE FROM "task_page_version" WHERE "agent_id" = OLD."id" AND "task_id" IS NULL;
	RETURN OLD;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "plan_page_version_agent_delete" ON "agent";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "plan_page_version_agent_delete"();
--> statement-breakpoint
CREATE TRIGGER "task_page_version_agent_delete" BEFORE DELETE ON "agent" FOR EACH ROW EXECUTE FUNCTION "task_page_version_agent_delete"();
