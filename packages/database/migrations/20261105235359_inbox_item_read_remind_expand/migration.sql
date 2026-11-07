DROP TRIGGER IF EXISTS "app_sync_update" ON "inbox_item_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "inbox_item_read";
--> statement-breakpoint
-- The release before this one still reads and writes snoozed_until and snoozed_through, in an
-- ON CONFLICT update among them, for up to an hour after this deploy, so they stand beside
-- remind_at and remind_through until a later migration drops them, and a trigger keeps each pair
-- equal whichever release wrote: a write that moves one pair moves the other.
ALTER TABLE "inbox_item_read" ADD COLUMN "remind_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_item_read" ADD COLUMN "remind_through" timestamp with time zone;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "inbox_item_read_remind_mirror"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."remind_at" IS NULL AND NEW."remind_through" IS NULL THEN
			NEW."remind_at" := NEW."snoozed_until";
			NEW."remind_through" := NEW."snoozed_through";
		ELSE
			NEW."snoozed_until" := NEW."remind_at";
			NEW."snoozed_through" := NEW."remind_through";
		END IF;
	ELSIF (NEW."remind_at", NEW."remind_through") IS DISTINCT FROM (OLD."remind_at", OLD."remind_through") THEN
		NEW."snoozed_until" := NEW."remind_at";
		NEW."snoozed_through" := NEW."remind_through";
	ELSIF (NEW."snoozed_until", NEW."snoozed_through") IS DISTINCT FROM (OLD."snoozed_until", OLD."snoozed_through") THEN
		NEW."remind_at" := NEW."snoozed_until";
		NEW."remind_through" := NEW."snoozed_through";
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "inbox_item_read_remind_mirror" BEFORE INSERT OR UPDATE ON "inbox_item_read" FOR EACH ROW EXECUTE FUNCTION "inbox_item_read_remind_mirror"();--> statement-breakpoint
UPDATE "inbox_item_read" SET "remind_at" = "snoozed_until", "remind_through" = "snoozed_through"
	WHERE ("remind_at", "remind_through") IS DISTINCT FROM ("snoozed_until", "snoozed_through");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_inbox_item_read"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'inbox_item_read',
		(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),
		coalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "inbox_item_read" FOR EACH ROW EXECUTE FUNCTION "app_sync_inbox_item_read"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "inbox_item_read" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."item_id" IS DISTINCT FROM NEW."item_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."marked_unread" IS DISTINCT FROM NEW."marked_unread" OR OLD."remind_at" IS DISTINCT FROM NEW."remind_at" OR OLD."remind_through" IS DISTINCT FROM NEW."remind_through") EXECUTE FUNCTION "app_sync_inbox_item_read"();
