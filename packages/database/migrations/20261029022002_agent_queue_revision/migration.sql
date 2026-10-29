DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_queue_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_queue_revision";
--> statement-breakpoint
CREATE TABLE "agent_queue_revision" (
	"agent_id" uuid PRIMARY KEY,
	"revision" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_queue_revision" ADD CONSTRAINT "agent_queue_revision_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent_queue_revision"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."agent_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."agent_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent_queue_revision" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent_queue_revision"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent_queue_revision" FOR EACH ROW WHEN (OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."revision" IS DISTINCT FROM NEW."revision") EXECUTE FUNCTION "luke_sync_agent_queue_revision"();
