DROP TRIGGER IF EXISTS "app_sync_update" ON "workspace_experiment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "workspace_experiment";
--> statement-breakpoint
-- Note that this migration may run where an earlier name of it already made the table, on a
-- preview database forked before it was generated again on main, so each step stands if done.
CREATE TABLE IF NOT EXISTS "workspace_experiment" (
	"organization_id" text,
	"experiment" text,
	"on" boolean NOT NULL,
	"changed_by" text,
	"changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_experiment_pkey" PRIMARY KEY("organization_id","experiment")
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workspace_experiment" ADD CONSTRAINT "workspace_experiment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workspace_experiment" ADD CONSTRAINT "workspace_experiment_changed_by_user_id_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_workspace_experiment"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "workspace_experiment" FOR EACH ROW EXECUTE FUNCTION "app_sync_workspace_experiment"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "workspace_experiment" FOR EACH ROW WHEN (OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."experiment" IS DISTINCT FROM NEW."experiment" OR OLD."on" IS DISTINCT FROM NEW."on" OR OLD."changed_by" IS DISTINCT FROM NEW."changed_by" OR OLD."changed_at" IS DISTINCT FROM NEW."changed_at") EXECUTE FUNCTION "app_sync_workspace_experiment"();
