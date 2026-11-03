DROP TRIGGER IF EXISTS "luke_sync_update" ON "plan_comment_thread";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "plan_comment_thread";
--> statement-breakpoint
ALTER TABLE "plan_comment_thread" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_comment_thread" ADD COLUMN "page_version" integer;--> statement-breakpoint
ALTER TABLE "plan_comment_thread" ADD COLUMN "page_element" text;--> statement-breakpoint
ALTER TABLE "plan_comment_thread" ADD CONSTRAINT "plan_comment_thread_page" CHECK (("page_id" is null) = ("page_version" is null) and ("page_element" is null or "page_id" is not null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_plan_comment_thread"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "plan_comment_thread" FOR EACH ROW EXECUTE FUNCTION "luke_sync_plan_comment_thread"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "plan_comment_thread" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."quote" IS DISTINCT FROM NEW."quote" OR OLD."anchor_from" IS DISTINCT FROM NEW."anchor_from" OR OLD."anchor_to" IS DISTINCT FROM NEW."anchor_to" OR OLD."section" IS DISTINCT FROM NEW."section" OR OLD."page_id" IS DISTINCT FROM NEW."page_id" OR OLD."page_version" IS DISTINCT FROM NEW."page_version" OR OLD."page_element" IS DISTINCT FROM NEW."page_element" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "luke_sync_plan_comment_thread"();
