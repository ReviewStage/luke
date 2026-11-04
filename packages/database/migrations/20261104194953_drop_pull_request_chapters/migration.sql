DROP TRIGGER IF EXISTS "app_sync_update" ON "account_preference";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "account_preference";
--> statement-breakpoint
DROP TABLE "pull_request_chapters";--> statement-breakpoint
-- The chapters' capture function goes too: dropping the table takes its triggers, never the function they called.
DROP FUNCTION IF EXISTS "app_sync_pull_request_chapters"();--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN "chapters_model";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_account_preference"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "account_preference" FOR EACH ROW EXECUTE FUNCTION "app_sync_account_preference"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "account_preference" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."link_open" IS DISTINCT FROM NEW."link_open" OR OLD."agent_enter" IS DISTINCT FROM NEW."agent_enter" OR OLD."setup_finished" IS DISTINCT FROM NEW."setup_finished" OR OLD."agent_model" IS DISTINCT FROM NEW."agent_model" OR OLD."agent_effort" IS DISTINCT FROM NEW."agent_effort" OR OLD."agent_context_window" IS DISTINCT FROM NEW."agent_context_window" OR OLD."experiments" IS DISTINCT FROM NEW."experiments" OR OLD."slack_notifications" IS DISTINCT FROM NEW."slack_notifications" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_account_preference"();
