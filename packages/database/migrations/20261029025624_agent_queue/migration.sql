DROP TRIGGER IF EXISTS "luke_sync_update" ON "queued_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "queued_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_queue_pause";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_queue_pause";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_queue_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_queue_revision";
--> statement-breakpoint
CREATE TABLE "agent_queue_pause" (
	"agent_id" uuid PRIMARY KEY,
	"because" text NOT NULL,
	"refusal" text,
	"paused_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_queue_revision" (
	"agent_id" uuid PRIMARY KEY,
	"revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queued_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"client_key" text NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb,
	"held_until" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "queued_message_agent_position" ON "queued_message" ("agent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "queued_message_agent_key" ON "queued_message" ("agent_id","client_key");--> statement-breakpoint
ALTER TABLE "agent_queue_pause" ADD CONSTRAINT "agent_queue_pause_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_queue_revision" ADD CONSTRAINT "agent_queue_revision_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queued_message" ADD CONSTRAINT "queued_message_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queued_message" ADD CONSTRAINT "queued_message_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_queued_message"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "queued_message" FOR EACH ROW EXECUTE FUNCTION "luke_sync_queued_message"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "queued_message" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."client_key" IS DISTINCT FROM NEW."client_key" OR OLD."text" IS DISTINCT FROM NEW."text" OR OLD."attachments" IS DISTINCT FROM NEW."attachments" OR OLD."held_until" IS DISTINCT FROM NEW."held_until" OR OLD."claimed_at" IS DISTINCT FROM NEW."claimed_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "luke_sync_queued_message"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent_queue_pause"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent_queue_pause" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent_queue_pause"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent_queue_pause" FOR EACH ROW WHEN (OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."because" IS DISTINCT FROM NEW."because" OR OLD."refusal" IS DISTINCT FROM NEW."refusal" OR OLD."paused_at" IS DISTINCT FROM NEW."paused_at") EXECUTE FUNCTION "luke_sync_agent_queue_pause"();
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
