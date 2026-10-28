DROP TRIGGER IF EXISTS "luke_sync_update" ON "turns";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "turns";
--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "cancel_requested_by" uuid;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_turns"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "coding_agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "coding_agent"."id"::text)), (jsonb_build_array('task', "coding_agent"."task_id"::text)), (jsonb_build_array('workspace', "coding_agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "coding_agent"."conversation_id" = OLD."conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "coding_agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "coding_agent"."id"::text)), (jsonb_build_array('task', "coding_agent"."task_id"::text)), (jsonb_build_array('workspace', "coding_agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "coding_agent"."conversation_id" = NEW."conversation_id"
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "turns" FOR EACH ROW EXECUTE FUNCTION "luke_sync_turns"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "turns" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."origin" IS DISTINCT FROM NEW."origin" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."reasoning_effort" IS DISTINCT FROM NEW."reasoning_effort" OR OLD."prompt_hash" IS DISTINCT FROM NEW."prompt_hash" OR OLD."tool_set_hash" IS DISTINCT FROM NEW."tool_set_hash" OR OLD."response_ids" IS DISTINCT FROM NEW."response_ids" OR OLD."usage" IS DISTINCT FROM NEW."usage" OR OLD."eve_turn_id" IS DISTINCT FROM NEW."eve_turn_id" OR OLD."queued_at" IS DISTINCT FROM NEW."queued_at" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."failure" IS DISTINCT FROM NEW."failure" OR OLD."failure_detail" IS DISTINCT FROM NEW."failure_detail" OR OLD."cancel_requested_at" IS DISTINCT FROM NEW."cancel_requested_at" OR OLD."cancel_request_key" IS DISTINCT FROM NEW."cancel_request_key" OR OLD."cancel_requested_by" IS DISTINCT FROM NEW."cancel_requested_by" OR OLD."fast_refused" IS DISTINCT FROM NEW."fast_refused") EXECUTE FUNCTION "luke_sync_turns"();
