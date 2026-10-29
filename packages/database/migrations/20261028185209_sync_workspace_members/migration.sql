DROP TRIGGER IF EXISTS "luke_sync_update" ON "invitation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "invitation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "plan_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "plan_revision";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_invitation"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "invitation" FOR EACH ROW EXECUTE FUNCTION "luke_sync_invitation"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "invitation" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."email" IS DISTINCT FROM NEW."email" OR OLD."role" IS DISTINCT FROM NEW."role" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."inviter_id" IS DISTINCT FROM NEW."inviter_id") EXECUTE FUNCTION "luke_sync_invitation"();
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
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "plan_revision" FOR EACH ROW WHEN (OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."actor" IS DISTINCT FROM NEW."actor" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."live_session_id" IS DISTINCT FROM NEW."live_session_id" OR OLD."changes" IS DISTINCT FROM NEW."changes" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."at" IS DISTINCT FROM NEW."at" OR OLD."restored_from" IS DISTINCT FROM NEW."restored_from") EXECUTE FUNCTION "luke_sync_plan_revision"();
