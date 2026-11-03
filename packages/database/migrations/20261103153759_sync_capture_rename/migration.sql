DROP TRIGGER IF EXISTS "app_sync_update" ON "task";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "task_block";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task_block";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "member";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "member";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "user";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "user";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "device";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "device";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "invitation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "invitation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "organization";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "organization";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "personal_workspace";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "personal_workspace";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "workspace_former_slug";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "workspace_former_slug";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "github_installation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "github_installation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "github_personal_token";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "github_personal_token";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "github_repository_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "github_repository_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "task_section";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task_section";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "task_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "repository_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "repository_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "task_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "task_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "mac_command";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "mac_command";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "runner_line";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "runner_line";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_queue";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_queue";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "device_agent_line";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "device_agent_line";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "device_agent_request";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "device_agent_request";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_comment_thread";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_comment_thread";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_comment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_comment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "inbox_item";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "inbox_item";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "inbox_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "inbox_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "inbox_item_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "inbox_item_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "automation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "automation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "automation_run";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "automation_run";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "plan_page_version";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "plan_page_version";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_browser_tab";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_browser_tab";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "messages";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "messages";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "conversations";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "conversations";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "turns";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "turns";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_delegation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_delegation";
--> statement-breakpoint
-- Sync's capture moves from the `luke_sync` channel and its `luke_sync_` triggers and functions to `app_sync`: every trigger and function under the old prefix is dropped here, and each synced table's capture is created under the new one below.
DO $$
DECLARE
	old record;
BEGIN
	FOR old IN
		SELECT t.tgname AS trigger_name, n.nspname AS table_schema, c.relname AS table_name
		FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE NOT t.tgisinternal AND starts_with(t.tgname, 'luke_sync_')
	LOOP
		EXECUTE format('DROP TRIGGER %I ON %I.%I', old.trigger_name, old.table_schema, old.table_name);
	END LOOP;
	FOR old IN
		SELECT p.proname AS function_name
		FROM pg_proc p
		WHERE p.pronamespace = 'public'::regnamespace AND starts_with(p.proname, 'luke_sync_')
	LOOP
		EXECUTE format('DROP FUNCTION public.%I()', old.function_name);
	END LOOP;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."number" IS DISTINCT FROM NEW."number" OR OLD."parent_task_id" IS DISTINCT FROM NEW."parent_task_id" OR OLD."mode" IS DISTINCT FROM NEW."mode" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."priority" IS DISTINCT FROM NEW."priority" OR OLD."assignee_id" IS DISTINCT FROM NEW."assignee_id" OR OLD."creator_actor" IS DISTINCT FROM NEW."creator_actor" OR OLD."creator_agent_id" IS DISTINCT FROM NEW."creator_agent_id" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."brief" IS DISTINCT FROM NEW."brief" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at" OR OLD."completed_at" IS DISTINCT FROM NEW."completed_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_task"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task_block"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "task_block" FOR EACH ROW EXECUTE FUNCTION "app_sync_task_block"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task_block" FOR EACH ROW WHEN (OLD."blocker_task_id" IS DISTINCT FROM NEW."blocker_task_id" OR OLD."blocked_task_id" IS DISTINCT FROM NEW."blocked_task_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_task_block"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."id"::text), jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."id"::text), jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."automation_run_id" IS DISTINCT FROM NEW."automation_run_id" OR OLD."automation_origin" IS DISTINCT FROM NEW."automation_origin" OR OLD."started_from" IS DISTINCT FROM NEW."started_from" OR OLD."started_by_agent_id" IS DISTINCT FROM NEW."started_by_agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort" OR OLD."context_window" IS DISTINCT FROM NEW."context_window" OR OLD."plan_snapshot" IS DISTINCT FROM NEW."plan_snapshot" OR OLD."prompt" IS DISTINCT FROM NEW."prompt" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."branch" IS DISTINCT FROM NEW."branch" OR OLD."start_branch" IS DISTINCT FROM NEW."start_branch" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."compacted_at" IS DISTINCT FROM NEW."compacted_at" OR OLD."published" IS DISTINCT FROM NEW."published" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at" OR OLD."archived_by" IS DISTINCT FROM NEW."archived_by" OR OLD."disabled_servers" IS DISTINCT FROM NEW."disabled_servers" OR OLD."mentioned_servers" IS DISTINCT FROM NEW."mentioned_servers" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."payer" IS DISTINCT FROM NEW."payer" OR OLD."runner_token_hash" IS DISTINCT FROM NEW."runner_token_hash" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_agent"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_member"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text), jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text), jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "member" FOR EACH ROW EXECUTE FUNCTION "app_sync_member"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "member" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."role" IS DISTINCT FROM NEW."role" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_member"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_user"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = OLD."id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = NEW."id"
		), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION "app_sync_user"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "user" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."email" IS DISTINCT FROM NEW."email" OR OLD."email_verified" IS DISTINCT FROM NEW."email_verified" OR OLD."image" IS DISTINCT FROM NEW."image" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."role" IS DISTINCT FROM NEW."role") EXECUTE FUNCTION "app_sync_user"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_device"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = OLD."user_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = NEW."user_id"
		), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "device" FOR EACH ROW EXECUTE FUNCTION "app_sync_device"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "device" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."name" IS DISTINCT FROM NEW."name") EXECUTE FUNCTION "app_sync_device"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_invitation"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "invitation" FOR EACH ROW EXECUTE FUNCTION "app_sync_invitation"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "invitation" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."email" IS DISTINCT FROM NEW."email" OR OLD."role" IS DISTINCT FROM NEW."role" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."inviter_id" IS DISTINCT FROM NEW."inviter_id") EXECUTE FUNCTION "app_sync_invitation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_organization"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "organization" FOR EACH ROW EXECUTE FUNCTION "app_sync_organization"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "organization" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."slug" IS DISTINCT FROM NEW."slug" OR OLD."logo" IS DISTINCT FROM NEW."logo" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."metadata" IS DISTINCT FROM NEW."metadata") EXECUTE FUNCTION "app_sync_organization"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_personal_workspace"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text), jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text), jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "personal_workspace" FOR EACH ROW EXECUTE FUNCTION "app_sync_personal_workspace"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "personal_workspace" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_personal_workspace"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_workspace_former_slug"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "workspace_former_slug" FOR EACH ROW EXECUTE FUNCTION "app_sync_workspace_former_slug"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "workspace_former_slug" FOR EACH ROW WHEN (OLD."slug" IS DISTINCT FROM NEW."slug" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_workspace_former_slug"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_github_installation"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "github_installation" FOR EACH ROW EXECUTE FUNCTION "app_sync_github_installation"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "github_installation" FOR EACH ROW WHEN (OLD."installation_id" IS DISTINCT FROM NEW."installation_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."account_id" IS DISTINCT FROM NEW."account_id" OR OLD."account_login" IS DISTINCT FROM NEW."account_login" OR OLD."account_type" IS DISTINCT FROM NEW."account_type" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_github_installation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_github_personal_token"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "github_personal_token" FOR EACH ROW EXECUTE FUNCTION "app_sync_github_personal_token"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "github_personal_token" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."key_version" IS DISTINCT FROM NEW."key_version" OR OLD."sealed_data_key" IS DISTINCT FROM NEW."sealed_data_key" OR OLD."sealed_token" IS DISTINCT FROM NEW."sealed_token" OR OLD."hint" IS DISTINCT FROM NEW."hint" OR OLD."github_user_id" IS DISTINCT FROM NEW."github_user_id" OR OLD."github_login" IS DISTINCT FROM NEW."github_login" OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."status_at" IS DISTINCT FROM NEW."status_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_github_personal_token"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_github_repository_read"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "github_repository_read" FOR EACH ROW EXECUTE FUNCTION "app_sync_github_repository_read"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "github_repository_read" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."readable" IS DISTINCT FROM NEW."readable") EXECUTE FUNCTION "app_sync_github_repository_read"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task_section"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "task_section" FOR EACH ROW EXECUTE FUNCTION "app_sync_task_section"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task_section" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."icon" IS DISTINCT FROM NEW."icon" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_task_section"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task_section_entry"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "task_section_entry" FOR EACH ROW EXECUTE FUNCTION "app_sync_task_section_entry"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task_section_entry" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."section_id" IS DISTINCT FROM NEW."section_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."added_at" IS DISTINCT FROM NEW."added_at") EXECUTE FUNCTION "app_sync_task_section_entry"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_section_entry"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_section_entry" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_section_entry"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_section_entry" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."section_id" IS DISTINCT FROM NEW."section_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."added_at" IS DISTINCT FROM NEW."added_at") EXECUTE FUNCTION "app_sync_agent_section_entry"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_repository_pin"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "repository_pin" FOR EACH ROW EXECUTE FUNCTION "app_sync_repository_pin"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "repository_pin" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at") EXECUTE FUNCTION "app_sync_repository_pin"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_task_pin"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "task_pin" FOR EACH ROW EXECUTE FUNCTION "app_sync_task_pin"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "task_pin" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at") EXECUTE FUNCTION "app_sync_task_pin"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_pin"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_pin" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_pin"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_pin" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at") EXECUTE FUNCTION "app_sync_agent_pin"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_mac_command"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "mac_command" FOR EACH ROW EXECUTE FUNCTION "app_sync_mac_command"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "mac_command" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."command" IS DISTINCT FROM NEW."command" OR OLD."timeout_seconds" IS DISTINCT FROM NEW."timeout_seconds" OR OLD."queued_at" IS DISTINCT FROM NEW."queued_at" OR OLD."claimed_at" IS DISTINCT FROM NEW."claimed_at" OR OLD."result" IS DISTINCT FROM NEW."result") EXECUTE FUNCTION "app_sync_mac_command"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_runner_line"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."agent_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."agent_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "runner_line" FOR EACH ROW EXECUTE FUNCTION "app_sync_runner_line"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "runner_line" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."launch" IS DISTINCT FROM NEW."launch" OR OLD."text" IS DISTINCT FROM NEW."text" OR OLD."line_id" IS DISTINCT FROM NEW."line_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_runner_line"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_queue"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."agent_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."agent_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_queue" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_queue"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_queue" FOR EACH ROW WHEN (OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."paused_because" IS DISTINCT FROM NEW."paused_because" OR OLD."paused_refusal" IS DISTINCT FROM NEW."paused_refusal") EXECUTE FUNCTION "app_sync_agent_queue"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_device_agent_line"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text), jsonb_build_array('agent', OLD."agent_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text), jsonb_build_array('agent', NEW."agent_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "device_agent_line" FOR EACH ROW EXECUTE FUNCTION "app_sync_device_agent_line"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "device_agent_line" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."sealed_secrets" IS DISTINCT FROM NEW."sealed_secrets" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."claimed_at" IS DISTINCT FROM NEW."claimed_at" OR OLD."claim_token" IS DISTINCT FROM NEW."claim_token" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."exit_code" IS DISTINCT FROM NEW."exit_code" OR OLD."launch_step" IS DISTINCT FROM NEW."launch_step") EXECUTE FUNCTION "app_sync_device_agent_line"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_device_agent_request"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "device_agent_request" FOR EACH ROW EXECUTE FUNCTION "app_sync_device_agent_request"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "device_agent_request" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."args" IS DISTINCT FROM NEW."args" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."claimed_at" IS DISTINCT FROM NEW."claimed_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at") EXECUTE FUNCTION "app_sync_device_agent_request"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_plan_comment_thread"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "plan_comment_thread" FOR EACH ROW EXECUTE FUNCTION "app_sync_plan_comment_thread"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "plan_comment_thread" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."quote" IS DISTINCT FROM NEW."quote" OR OLD."anchor_from" IS DISTINCT FROM NEW."anchor_from" OR OLD."anchor_to" IS DISTINCT FROM NEW."anchor_to" OR OLD."section" IS DISTINCT FROM NEW."section" OR OLD."page_id" IS DISTINCT FROM NEW."page_id" OR OLD."page_version" IS DISTINCT FROM NEW."page_version" OR OLD."page_element" IS DISTINCT FROM NEW."page_element" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_plan_comment_thread"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_plan_comment"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "plan_comment" FOR EACH ROW EXECUTE FUNCTION "app_sync_plan_comment"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "plan_comment" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."thread_id" IS DISTINCT FROM NEW."thread_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."actor" IS DISTINCT FROM NEW."actor" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."words" IS DISTINCT FROM NEW."words" OR OLD."asked_actor" IS DISTINCT FROM NEW."asked_actor" OR OLD."asked_agent_id" IS DISTINCT FROM NEW."asked_agent_id" OR OLD."client_key" IS DISTINCT FROM NEW."client_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."edited_at" IS DISTINCT FROM NEW."edited_at") EXECUTE FUNCTION "app_sync_plan_comment"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_inbox_item"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('agent', OLD."agent_id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = OLD."organization_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('agent', NEW."agent_id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = NEW."organization_id"
		), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "inbox_item" FOR EACH ROW EXECUTE FUNCTION "app_sync_inbox_item"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "inbox_item" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."addressee_id" IS DISTINCT FROM NEW."addressee_id" OR OLD."key" IS DISTINCT FROM NEW."key" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."needs_reply" IS DISTINCT FROM NEW."needs_reply" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."answer_key" IS DISTINCT FROM NEW."answer_key" OR OLD."answered_by" IS DISTINCT FROM NEW."answered_by" OR OLD."closed_reason" IS DISTINCT FROM NEW."closed_reason" OR OLD."closed_by" IS DISTINCT FROM NEW."closed_by" OR OLD."posted_at" IS DISTINCT FROM NEW."posted_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."open_ask_message_id" IS DISTINCT FROM NEW."open_ask_message_id") EXECUTE FUNCTION "app_sync_inbox_item"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_inbox_message"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."item_id"
		), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "inbox_message" FOR EACH ROW EXECUTE FUNCTION "app_sync_inbox_message"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "inbox_message" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."item_id" IS DISTINCT FROM NEW."item_id" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."text" IS DISTINCT FROM NEW."text" OR OLD."ask" IS DISTINCT FROM NEW."ask" OR OLD."answers" IS DISTINCT FROM NEW."answers" OR OLD."addressee_id" IS DISTINCT FROM NEW."addressee_id" OR OLD."client_key" IS DISTINCT FROM NEW."client_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_inbox_message"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_inbox_item_read"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."item_id"
		), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "inbox_item_read" FOR EACH ROW EXECUTE FUNCTION "app_sync_inbox_item_read"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "inbox_item_read" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."item_id" IS DISTINCT FROM NEW."item_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."marked_unread" IS DISTINCT FROM NEW."marked_unread") EXECUTE FUNCTION "app_sync_inbox_item_read"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_attachment"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
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
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "attachment" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."inbox_item_id" IS DISTINCT FROM NEW."inbox_item_id" OR OLD."inbox_message_id" IS DISTINCT FROM NEW."inbox_message_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."plan_comment_id" IS DISTINCT FROM NEW."plan_comment_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."content_type" IS DISTINCT FROM NEW."content_type" OR OLD."sha256" IS DISTINCT FROM NEW."sha256" OR OLD."width" IS DISTINCT FROM NEW."width" OR OLD."height" IS DISTINCT FROM NEW."height" OR OLD."byte_count" IS DISTINCT FROM NEW."byte_count" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."saved_at" IS DISTINCT FROM NEW."saved_at") EXECUTE FUNCTION "app_sync_attachment"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_automation"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text), jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text), jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "automation" FOR EACH ROW EXECUTE FUNCTION "app_sync_automation"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "automation" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."enabled" IS DISTINCT FROM NEW."enabled" OR OLD."trigger_kind" IS DISTINCT FROM NEW."trigger_kind" OR OLD."trigger" IS DISTINCT FROM NEW."trigger" OR OLD."action" IS DISTINCT FROM NEW."action" OR OLD."guards" IS DISTINCT FROM NEW."guards" OR OLD."next_run_at" IS DISTINCT FROM NEW."next_run_at" OR OLD."webhook_secret_hash" IS DISTINCT FROM NEW."webhook_secret_hash" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."target_kind" IS DISTINCT FROM NEW."target_kind" OR OLD."target_agent_id" IS DISTINCT FROM NEW."target_agent_id" OR OLD."archive_successful" IS DISTINCT FROM NEW."archive_successful" OR OLD."slack_delivery" IS DISTINCT FROM NEW."slack_delivery" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_automation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_automation_run"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "automation"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "automation"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "automation"."id" = OLD."automation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "automation"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "automation"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "automation"."id" = NEW."automation_id"
		), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "automation_run" FOR EACH ROW EXECUTE FUNCTION "app_sync_automation_run"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "automation_run" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."dedupe_key" IS DISTINCT FROM NEW."dedupe_key" OR OLD."firing" IS DISTINCT FROM NEW."firing" OR OLD."payload" IS DISTINCT FROM NEW."payload" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."reason" IS DISTINCT FROM NEW."reason" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."fired_at" IS DISTINCT FROM NEW."fired_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."claimed_agent_id" IS DISTINCT FROM NEW."claimed_agent_id" OR OLD."archive_settled_at" IS DISTINCT FROM NEW."archive_settled_at" OR OLD."slack_delivered_at" IS DISTINCT FROM NEW."slack_delivered_at") EXECUTE FUNCTION "app_sync_automation_run"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_plan_revision"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "plan_revision" FOR EACH ROW EXECUTE FUNCTION "app_sync_plan_revision"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "plan_revision" FOR EACH ROW WHEN (OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."actor" IS DISTINCT FROM NEW."actor" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."changes" IS DISTINCT FROM NEW."changes" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."at" IS DISTINCT FROM NEW."at" OR OLD."restored_from" IS DISTINCT FROM NEW."restored_from") EXECUTE FUNCTION "app_sync_plan_revision"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_plan_page_version"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "plan_page_version" FOR EACH ROW EXECUTE FUNCTION "app_sync_plan_page_version"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "plan_page_version" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."page_id" IS DISTINCT FROM NEW."page_id" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."html" IS DISTINCT FROM NEW."html" OR OLD."shown_by" IS DISTINCT FROM NEW."shown_by" OR OLD."at" IS DISTINCT FROM NEW."at") EXECUTE FUNCTION "app_sync_plan_page_version"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_browser_tab"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_browser_tab" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_browser_tab"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_browser_tab" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."target_id" IS DISTINCT FROM NEW."target_id" OR OLD."address" IS DISTINCT FROM NEW."address" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."opened_by" IS DISTINCT FROM NEW."opened_by" OR OLD."opened_by_user_id" IS DISTINCT FROM NEW."opened_by_user_id" OR OLD."driver_user_id" IS DISTINCT FROM NEW."driver_user_id" OR OLD."held_until" IS DISTINCT FROM NEW."held_until" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."last_acted_at" IS DISTINCT FROM NEW."last_acted_at" OR OLD."cursor_x" IS DISTINCT FROM NEW."cursor_x" OR OLD."cursor_y" IS DISTINCT FROM NEW."cursor_y" OR OLD."cursor_kind" IS DISTINCT FROM NEW."cursor_kind" OR OLD."cursor_viewport_w" IS DISTINCT FROM NEW."cursor_viewport_w" OR OLD."cursor_viewport_h" IS DISTINCT FROM NEW."cursor_viewport_h" OR OLD."cursor_at" IS DISTINCT FROM NEW."cursor_at") EXECUTE FUNCTION "app_sync_agent_browser_tab"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_messages"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "messages" FOR EACH ROW EXECUTE FUNCTION "app_sync_messages"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "messages" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."client_id" IS DISTINCT FROM NEW."client_id" OR OLD."role" IS DISTINCT FROM NEW."role" OR OLD."parts" IS DISTINCT FROM NEW."parts" OR OLD."metadata" IS DISTINCT FROM NEW."metadata" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."finished_at" IS DISTINCT FROM NEW."finished_at" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."placed_at" IS DISTINCT FROM NEW."placed_at" OR OLD."sender" IS DISTINCT FROM NEW."sender" OR OLD."sender_user_id" IS DISTINCT FROM NEW."sender_user_id" OR OLD."sender_name" IS DISTINCT FROM NEW."sender_name" OR OLD."sender_model" IS DISTINCT FROM NEW."sender_model" OR OLD."sender_agent_id" IS DISTINCT FROM NEW."sender_agent_id" OR OLD."taken_after_step" IS DISTINCT FROM NEW."taken_after_step" OR OLD."withdrawn_at" IS DISTINCT FROM NEW."withdrawn_at") EXECUTE FUNCTION "app_sync_messages"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_conversations"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."id"::text), jsonb_build_array('conversation', OLD."parent_conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."id"::text), jsonb_build_array('conversation', NEW."parent_conversation_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "conversations" FOR EACH ROW EXECUTE FUNCTION "app_sync_conversations"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "conversations" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."parent_conversation_id" IS DISTINCT FROM NEW."parent_conversation_id" OR OLD."runtime_session_id" IS DISTINCT FROM NEW."runtime_session_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" OR OLD."journal_revision" IS DISTINCT FROM NEW."journal_revision" OR OLD."label" IS DISTINCT FROM NEW."label" OR OLD."expects_completion" IS DISTINCT FROM NEW."expects_completion" OR OLD."runtime" IS DISTINCT FROM NEW."runtime" OR OLD."native_session" IS DISTINCT FROM NEW."native_session" OR OLD."rewound_revision" IS DISTINCT FROM NEW."rewound_revision" OR OLD."native_rewind" IS DISTINCT FROM NEW."native_rewind" OR OLD."native_handed" IS DISTINCT FROM NEW."native_handed") EXECUTE FUNCTION "app_sync_conversations"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_turns"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
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
CREATE OR REPLACE FUNCTION "app_sync_agent_delegation"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "conversations"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('conversation', "conversations"."parent_conversation_id"::text))) AS "sync_lookup"("topic")
			WHERE "conversations"."id" = OLD."child_conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "conversations"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('conversation', "conversations"."parent_conversation_id"::text))) AS "sync_lookup"("topic")
			WHERE "conversations"."id" = NEW."child_conversation_id"
		), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_delegation" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_delegation"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_delegation" FOR EACH ROW WHEN (OLD."child_conversation_id" IS DISTINCT FROM NEW."child_conversation_id" OR OLD."call_id" IS DISTINCT FROM NEW."call_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort") EXECUTE FUNCTION "app_sync_agent_delegation"();
