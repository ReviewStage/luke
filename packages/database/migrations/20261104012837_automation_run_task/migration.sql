DROP TRIGGER IF EXISTS "app_sync_update" ON "automation_run";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "automation_run";
--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "task_id" uuid;--> statement-breakpoint
CREATE INDEX "automation_run_task" ON "automation_run" ("task_id") WHERE "task_id" is not null;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_automation_run"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "automation"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "automation"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "automation"."id" = OLD."automation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "automation"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "automation"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "automation"."id" = NEW."automation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'UPDATE' THEN
		IF TG_OP <> 'INSERT' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
		END IF;
		IF TG_OP <> 'DELETE' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
		END IF;
		INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
			pg_current_xact_id()::text::bigint, 'automation_run',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "automation_run" FOR EACH ROW EXECUTE FUNCTION "app_sync_automation_run"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "automation_run" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."dedupe_key" IS DISTINCT FROM NEW."dedupe_key" OR OLD."firing" IS DISTINCT FROM NEW."firing" OR OLD."payload" IS DISTINCT FROM NEW."payload" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."reason" IS DISTINCT FROM NEW."reason" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."fired_at" IS DISTINCT FROM NEW."fired_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."claimed_agent_id" IS DISTINCT FROM NEW."claimed_agent_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."archive_settled_at" IS DISTINCT FROM NEW."archive_settled_at" OR OLD."slack_delivered_at" IS DISTINCT FROM NEW."slack_delivered_at") EXECUTE FUNCTION "app_sync_automation_run"();
