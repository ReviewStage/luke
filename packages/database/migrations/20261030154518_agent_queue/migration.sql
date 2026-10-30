DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_queue";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_queue";
--> statement-breakpoint
CREATE TABLE "agent_queue" (
	"agent_id" uuid PRIMARY KEY,
	"revision" integer NOT NULL,
	"paused_because" text,
	"paused_refusal" text
);
--> statement-breakpoint
CREATE TABLE "queued_message" (
	"id" uuid PRIMARY KEY,
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb,
	"editing" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_preference" ADD COLUMN "agent_enter" text;--> statement-breakpoint
CREATE INDEX "queued_message_agent_position" ON "queued_message" ("agent_id","position");--> statement-breakpoint
ALTER TABLE "agent_queue" ADD CONSTRAINT "agent_queue_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queued_message" ADD CONSTRAINT "queued_message_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queued_message" ADD CONSTRAINT "queued_message_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent_queue"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent_queue" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent_queue"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent_queue" FOR EACH ROW WHEN (OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."paused_because" IS DISTINCT FROM NEW."paused_because" OR OLD."paused_refusal" IS DISTINCT FROM NEW."paused_refusal") EXECUTE FUNCTION "luke_sync_agent_queue"();
