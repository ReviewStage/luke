DROP TRIGGER IF EXISTS "luke_sync_update" ON "plan_page_version";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "plan_page_version";
--> statement-breakpoint
ALTER TABLE "plan_page_version" ADD COLUMN "source_path" text;--> statement-breakpoint
CREATE INDEX "plan_page_version_source_path" ON "plan_page_version" ("source_path");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_plan_page_version"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('agent', OLD."agent_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('agent', NEW."agent_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "plan_page_version" FOR EACH ROW EXECUTE FUNCTION "luke_sync_plan_page_version"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "plan_page_version" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."page_id" IS DISTINCT FROM NEW."page_id" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."source_path" IS DISTINCT FROM NEW."source_path" OR OLD."html" IS DISTINCT FROM NEW."html" OR OLD."shown_by" IS DISTINCT FROM NEW."shown_by" OR OLD."at" IS DISTINCT FROM NEW."at") EXECUTE FUNCTION "luke_sync_plan_page_version"();
