DROP TRIGGER IF EXISTS "luke_sync_update" ON "automation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "automation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "automation_run";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "automation_run";
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "slack_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "slack_delivered_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_automation"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text), jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text), jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "automation" FOR EACH ROW EXECUTE FUNCTION "luke_sync_automation"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "automation" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."enabled" IS DISTINCT FROM NEW."enabled" OR OLD."trigger_kind" IS DISTINCT FROM NEW."trigger_kind" OR OLD."trigger" IS DISTINCT FROM NEW."trigger" OR OLD."action" IS DISTINCT FROM NEW."action" OR OLD."guards" IS DISTINCT FROM NEW."guards" OR OLD."next_run_at" IS DISTINCT FROM NEW."next_run_at" OR OLD."webhook_secret_hash" IS DISTINCT FROM NEW."webhook_secret_hash" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."target_kind" IS DISTINCT FROM NEW."target_kind" OR OLD."target_agent_id" IS DISTINCT FROM NEW."target_agent_id" OR OLD."archive_successful" IS DISTINCT FROM NEW."archive_successful" OR OLD."slack_delivery" IS DISTINCT FROM NEW."slack_delivery" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "luke_sync_automation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_automation_run"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "automation_run" FOR EACH ROW EXECUTE FUNCTION "luke_sync_automation_run"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "automation_run" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."dedupe_key" IS DISTINCT FROM NEW."dedupe_key" OR OLD."firing" IS DISTINCT FROM NEW."firing" OR OLD."payload" IS DISTINCT FROM NEW."payload" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."reason" IS DISTINCT FROM NEW."reason" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."fired_at" IS DISTINCT FROM NEW."fired_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."claimed_agent_id" IS DISTINCT FROM NEW."claimed_agent_id" OR OLD."archive_settled_at" IS DISTINCT FROM NEW."archive_settled_at" OR OLD."slack_delivered_at" IS DISTINCT FROM NEW."slack_delivered_at") EXECUTE FUNCTION "luke_sync_automation_run"();
