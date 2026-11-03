DROP TRIGGER IF EXISTS "luke_sync_update" ON "workspace_former_slug";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "workspace_former_slug";
--> statement-breakpoint
CREATE TABLE "workspace_former_slug" (
	"slug" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workspace_former_slug_organization_idx" ON "workspace_former_slug" ("organization_id");--> statement-breakpoint
ALTER TABLE "workspace_former_slug" ADD CONSTRAINT "workspace_former_slug_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_workspace_former_slug"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "workspace_former_slug" FOR EACH ROW EXECUTE FUNCTION "luke_sync_workspace_former_slug"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "workspace_former_slug" FOR EACH ROW WHEN (OLD."slug" IS DISTINCT FROM NEW."slug" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "luke_sync_workspace_former_slug"();
