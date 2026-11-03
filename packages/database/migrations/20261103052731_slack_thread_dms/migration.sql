DROP TRIGGER IF EXISTS "luke_sync_update" ON "inbox_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "inbox_message";
--> statement-breakpoint
ALTER TABLE "inbox_message" ADD COLUMN "slack_dm" jsonb;--> statement-breakpoint
ALTER TABLE "account_preference" ADD COLUMN "slack_notifications" boolean;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_inbox_message"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "inbox_message" FOR EACH ROW EXECUTE FUNCTION "luke_sync_inbox_message"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "inbox_message" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."item_id" IS DISTINCT FROM NEW."item_id" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."text" IS DISTINCT FROM NEW."text" OR OLD."ask" IS DISTINCT FROM NEW."ask" OR OLD."answers" IS DISTINCT FROM NEW."answers" OR OLD."addressee_id" IS DISTINCT FROM NEW."addressee_id" OR OLD."client_key" IS DISTINCT FROM NEW."client_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "luke_sync_inbox_message"();
