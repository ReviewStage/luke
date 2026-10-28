DROP TRIGGER IF EXISTS "luke_sync_update" ON "plan_page_version";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "plan_page_version";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_browser_tab";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_browser_tab";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_plan_page_version"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "plan_page_version" FOR EACH ROW EXECUTE FUNCTION "luke_sync_plan_page_version"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "plan_page_version" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."page_id" IS DISTINCT FROM NEW."page_id" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."html" IS DISTINCT FROM NEW."html" OR OLD."shown_by" IS DISTINCT FROM NEW."shown_by" OR OLD."at" IS DISTINCT FROM NEW."at") EXECUTE FUNCTION "luke_sync_plan_page_version"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent_browser_tab"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent_browser_tab" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent_browser_tab"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent_browser_tab" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."target_id" IS DISTINCT FROM NEW."target_id" OR OLD."address" IS DISTINCT FROM NEW."address" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."opened_by" IS DISTINCT FROM NEW."opened_by" OR OLD."opened_by_user_id" IS DISTINCT FROM NEW."opened_by_user_id" OR OLD."driver_user_id" IS DISTINCT FROM NEW."driver_user_id" OR OLD."held_until" IS DISTINCT FROM NEW."held_until" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."last_acted_at" IS DISTINCT FROM NEW."last_acted_at" OR OLD."cursor_x" IS DISTINCT FROM NEW."cursor_x" OR OLD."cursor_y" IS DISTINCT FROM NEW."cursor_y" OR OLD."cursor_kind" IS DISTINCT FROM NEW."cursor_kind" OR OLD."cursor_viewport_w" IS DISTINCT FROM NEW."cursor_viewport_w" OR OLD."cursor_viewport_h" IS DISTINCT FROM NEW."cursor_viewport_h" OR OLD."cursor_at" IS DISTINCT FROM NEW."cursor_at") EXECUTE FUNCTION "luke_sync_agent_browser_tab"();
