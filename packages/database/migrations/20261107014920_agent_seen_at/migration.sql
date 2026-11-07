DROP TRIGGER IF EXISTS "app_sync_update" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent";
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "seen_at" timestamp with time zone;
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
