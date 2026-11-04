DROP TRIGGER IF EXISTS "app_sync_update" ON "installed_skill";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "installed_skill";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_installed_skill"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-skills', OLD."organization_id"::text), jsonb_build_array('account-skills', OLD."owner_user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-skills', NEW."organization_id"::text), jsonb_build_array('account-skills', NEW."owner_user_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "installed_skill" FOR EACH ROW EXECUTE FUNCTION "app_sync_installed_skill"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "installed_skill" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."owner_user_id" IS DISTINCT FROM NEW."owner_user_id" OR OLD."installed_by_user_id" IS DISTINCT FROM NEW."installed_by_user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."description" IS DISTINCT FROM NEW."description" OR OLD."user_invocable" IS DISTINCT FROM NEW."user_invocable" OR OLD."source" IS DISTINCT FROM NEW."source" OR OLD."computed_hash" IS DISTINCT FROM NEW."computed_hash" OR OLD."enabled" IS DISTINCT FROM NEW."enabled" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_installed_skill"();
