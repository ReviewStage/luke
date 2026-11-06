DROP TRIGGER IF EXISTS "app_sync_update" ON "messages";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "messages";
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_automation_id" uuid;--> statement-breakpoint
-- An automation's line kept only its name until now; every one already kept names the automation its agent belongs to, by the id a reader opens it by: the automation whose run started the agent, under its name now or the one its run kept, or the automation that sends every run to the agent, under its name now. Note that a line whose automation is gone, or was renamed since and holds the agent only as its target, stays unnamed, as it reads already.
UPDATE "messages" SET "sender_automation_id" = "automation"."id"
FROM "agent", "automation"
WHERE "agent"."conversation_id" = "messages"."conversation_id"
  AND "messages"."sender" = 'automation'
  AND "messages"."sender_automation_id" IS NULL
  AND (
    ("automation"."id" = "agent"."automation_id"
      AND "messages"."sender_name" IN ("automation"."name", "agent"."automation_origin" ->> 'name'))
    OR ("automation"."target_agent_id" = "agent"."id"
      AND "messages"."sender_name" = "automation"."name")
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_messages"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
	END IF;
	IF TG_OP <> 'UPDATE' OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."withdrawn_at" IS DISTINCT FROM NEW."withdrawn_at" THEN
		IF TG_OP <> 'INSERT' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
		END IF;
		IF TG_OP <> 'DELETE' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
		END IF;
		INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
			pg_current_xact_id()::text::bigint, 'messages',
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
--> statement-breakpoint
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "messages" FOR EACH ROW EXECUTE FUNCTION "app_sync_messages"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "messages" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."client_id" IS DISTINCT FROM NEW."client_id" OR OLD."role" IS DISTINCT FROM NEW."role" OR OLD."parts" IS DISTINCT FROM NEW."parts" OR OLD."metadata" IS DISTINCT FROM NEW."metadata" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."finished_at" IS DISTINCT FROM NEW."finished_at" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."placed_at" IS DISTINCT FROM NEW."placed_at" OR OLD."sender" IS DISTINCT FROM NEW."sender" OR OLD."sender_user_id" IS DISTINCT FROM NEW."sender_user_id" OR OLD."sender_name" IS DISTINCT FROM NEW."sender_name" OR OLD."sender_model" IS DISTINCT FROM NEW."sender_model" OR OLD."sender_agent_id" IS DISTINCT FROM NEW."sender_agent_id" OR OLD."sender_automation_id" IS DISTINCT FROM NEW."sender_automation_id" OR OLD."taken_after_step" IS DISTINCT FROM NEW."taken_after_step" OR OLD."withdrawn_at" IS DISTINCT FROM NEW."withdrawn_at") EXECUTE FUNCTION "app_sync_messages"();
