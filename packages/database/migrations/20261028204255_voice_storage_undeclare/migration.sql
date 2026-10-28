DROP TRIGGER IF EXISTS "luke_sync_update" ON "plan_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "plan_revision";
--> statement-breakpoint
-- The voice tables (voice_sessions, voice_transcript_segments, voice_avatar_sessions, and
-- voice_session_usage), plan_revision.live_session_id, account_preference.voice, and
-- device_agent_request's exit_code, stdout, and stderr are declared no longer, and this release reads
-- and writes them nowhere, but the release before it still names some while this one migrates; a later
-- release's migration drops them (apps/web/server/README.md, "Dropping a column ... takes two
-- deployments").
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_plan_revision"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "plan_revision" FOR EACH ROW EXECUTE FUNCTION "luke_sync_plan_revision"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "plan_revision" FOR EACH ROW WHEN (OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."actor" IS DISTINCT FROM NEW."actor" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."changes" IS DISTINCT FROM NEW."changes" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."at" IS DISTINCT FROM NEW."at" OR OLD."restored_from" IS DISTINCT FROM NEW."restored_from") EXECUTE FUNCTION "luke_sync_plan_revision"();
