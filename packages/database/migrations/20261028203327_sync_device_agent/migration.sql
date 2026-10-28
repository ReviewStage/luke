DROP TRIGGER IF EXISTS "luke_sync_update" ON "device_agent_line";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "device_agent_line";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "device_agent_request";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "device_agent_request";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_device_agent_line"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "device_agent_line" FOR EACH ROW EXECUTE FUNCTION "luke_sync_device_agent_line"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "device_agent_line" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."sealed_secrets" IS DISTINCT FROM NEW."sealed_secrets" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."claimed_at" IS DISTINCT FROM NEW."claimed_at" OR OLD."claim_token" IS DISTINCT FROM NEW."claim_token" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."exit_code" IS DISTINCT FROM NEW."exit_code") EXECUTE FUNCTION "luke_sync_device_agent_line"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_device_agent_request"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "device_agent_request" FOR EACH ROW EXECUTE FUNCTION "luke_sync_device_agent_request"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "device_agent_request" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."args" IS DISTINCT FROM NEW."args" OR OLD."exit_code" IS DISTINCT FROM NEW."exit_code" OR OLD."stdout" IS DISTINCT FROM NEW."stdout" OR OLD."stderr" IS DISTINCT FROM NEW."stderr" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."claimed_at" IS DISTINCT FROM NEW."claimed_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at") EXECUTE FUNCTION "luke_sync_device_agent_request"();
