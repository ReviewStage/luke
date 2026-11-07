CREATE OR REPLACE FUNCTION "app_sync_conversations"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."id"::text), jsonb_build_array('conversation', OLD."parent_conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."id"::text), jsonb_build_array('conversation', NEW."parent_conversation_id"::text));
	END IF;
	IF TG_OP <> 'UPDATE' OR OLD."runtime_session_id" IS DISTINCT FROM NEW."runtime_session_id" THEN
		IF TG_OP <> 'INSERT' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
		END IF;
		IF TG_OP <> 'DELETE' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
		END IF;
		INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
			pg_current_xact_id()::text::bigint, 'conversations',
			(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),
			coalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');
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
