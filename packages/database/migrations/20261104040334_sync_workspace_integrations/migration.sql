DROP TRIGGER IF EXISTS "app_sync_update" ON "integration_installation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "integration_installation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "slack_installation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "slack_installation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "slack_channel_repository";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "slack_channel_repository";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_integration_installation"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "integration_installation" FOR EACH ROW EXECUTE FUNCTION "app_sync_integration_installation"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "integration_installation" FOR EACH ROW WHEN (OLD."provider" IS DISTINCT FROM NEW."provider" OR OLD."external_id" IS DISTINCT FROM NEW."external_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."account_label" IS DISTINCT FROM NEW."account_label" OR OLD."linked_by_user_id" IS DISTINCT FROM NEW."linked_by_user_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_integration_installation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_slack_installation"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "slack_installation" FOR EACH ROW EXECUTE FUNCTION "app_sync_slack_installation"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "slack_installation" FOR EACH ROW WHEN (OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."team_id" IS DISTINCT FROM NEW."team_id" OR OLD."team_name" IS DISTINCT FROM NEW."team_name" OR OLD."default_repository" IS DISTINCT FROM NEW."default_repository" OR OLD."linked_by_user_id" IS DISTINCT FROM NEW."linked_by_user_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_slack_installation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_slack_channel_repository"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "slack_channel_repository" FOR EACH ROW EXECUTE FUNCTION "app_sync_slack_channel_repository"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "slack_channel_repository" FOR EACH ROW WHEN (OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."channel_id" IS DISTINCT FROM NEW."channel_id" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_slack_channel_repository"();
