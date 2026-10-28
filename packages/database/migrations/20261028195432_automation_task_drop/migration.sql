DROP TRIGGER IF EXISTS "luke_sync_update" ON "automation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "automation";
--> statement-breakpoint
ALTER TABLE "automation" DROP CONSTRAINT "automation_plan_id_plan_id_fkey";--> statement-breakpoint
DROP INDEX "automation_trigger_task";--> statement-breakpoint
ALTER TABLE "automation" DROP COLUMN "task_id";--> statement-breakpoint
CREATE INDEX "automation_trigger_kind" ON "automation" ("trigger_kind");
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
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "automation" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."enabled" IS DISTINCT FROM NEW."enabled" OR OLD."trigger_kind" IS DISTINCT FROM NEW."trigger_kind" OR OLD."trigger" IS DISTINCT FROM NEW."trigger" OR OLD."action" IS DISTINCT FROM NEW."action" OR OLD."guards" IS DISTINCT FROM NEW."guards" OR OLD."next_run_at" IS DISTINCT FROM NEW."next_run_at" OR OLD."webhook_secret_hash" IS DISTINCT FROM NEW."webhook_secret_hash" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."target_kind" IS DISTINCT FROM NEW."target_kind" OR OLD."target_agent_id" IS DISTINCT FROM NEW."target_agent_id" OR OLD."archive_successful" IS DISTINCT FROM NEW."archive_successful" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "luke_sync_automation"();
