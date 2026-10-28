DROP TRIGGER IF EXISTS "luke_sync_update" ON "user";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "user";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "inbox_item";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "inbox_item";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "inbox_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "inbox_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "inbox_item_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "inbox_item_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "channel";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "channel";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "automation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "automation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "automation_run";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "automation_run";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_user"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = OLD."id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = NEW."id"
		), '[]');
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION "luke_sync_user"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "user" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."email" IS DISTINCT FROM NEW."email" OR OLD."email_verified" IS DISTINCT FROM NEW."email_verified" OR OLD."image" IS DISTINCT FROM NEW."image" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."role" IS DISTINCT FROM NEW."role") EXECUTE FUNCTION "luke_sync_user"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_inbox_item"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('agent', OLD."agent_id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = OLD."organization_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('agent', NEW."agent_id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = NEW."organization_id"
		), '[]');
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "inbox_item" FOR EACH ROW EXECUTE FUNCTION "luke_sync_inbox_item"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "inbox_item" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."channel_id" IS DISTINCT FROM NEW."channel_id" OR OLD."addressee_id" IS DISTINCT FROM NEW."addressee_id" OR OLD."key" IS DISTINCT FROM NEW."key" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."needs_reply" IS DISTINCT FROM NEW."needs_reply" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."answer_key" IS DISTINCT FROM NEW."answer_key" OR OLD."answered_by" IS DISTINCT FROM NEW."answered_by" OR OLD."closed_reason" IS DISTINCT FROM NEW."closed_reason" OR OLD."closed_by" IS DISTINCT FROM NEW."closed_by" OR OLD."posted_at" IS DISTINCT FROM NEW."posted_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."open_ask_message_id" IS DISTINCT FROM NEW."open_ask_message_id") EXECUTE FUNCTION "luke_sync_inbox_item"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_inbox_message"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "inbox_item"."task_id"::text)), (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."item_id"
		), '[]');
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "inbox_message" FOR EACH ROW EXECUTE FUNCTION "luke_sync_inbox_message"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "inbox_message" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."item_id" IS DISTINCT FROM NEW."item_id" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."text" IS DISTINCT FROM NEW."text" OR OLD."ask" IS DISTINCT FROM NEW."ask" OR OLD."answers" IS DISTINCT FROM NEW."answers" OR OLD."addressee_id" IS DISTINCT FROM NEW."addressee_id" OR OLD."client_key" IS DISTINCT FROM NEW."client_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "luke_sync_inbox_message"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_inbox_item_read"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "inbox_item_read" FOR EACH ROW EXECUTE FUNCTION "luke_sync_inbox_item_read"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "inbox_item_read" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."item_id" IS DISTINCT FROM NEW."item_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."marked_unread" IS DISTINCT FROM NEW."marked_unread") EXECUTE FUNCTION "luke_sync_inbox_item_read"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_attachment"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."inbox_item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."inbox_item_id"
		), '[]');
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "attachment" FOR EACH ROW EXECUTE FUNCTION "luke_sync_attachment"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "attachment" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."inbox_item_id" IS DISTINCT FROM NEW."inbox_item_id" OR OLD."inbox_message_id" IS DISTINCT FROM NEW."inbox_message_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."plan_comment_id" IS DISTINCT FROM NEW."plan_comment_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."content_type" IS DISTINCT FROM NEW."content_type" OR OLD."sha256" IS DISTINCT FROM NEW."sha256" OR OLD."width" IS DISTINCT FROM NEW."width" OR OLD."height" IS DISTINCT FROM NEW."height" OR OLD."byte_count" IS DISTINCT FROM NEW."byte_count" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."saved_at" IS DISTINCT FROM NEW."saved_at") EXECUTE FUNCTION "luke_sync_attachment"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_channel"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = OLD."organization_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = NEW."organization_id"
		), '[]');
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "channel" FOR EACH ROW EXECUTE FUNCTION "luke_sync_channel"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "channel" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."purpose" IS DISTINCT FROM NEW."purpose" OR OLD."project" IS DISTINCT FROM NEW."project" OR OLD."created_by" IS DISTINCT FROM NEW."created_by" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at") EXECUTE FUNCTION "luke_sync_channel"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_automation"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text), jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text), jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "automation" FOR EACH ROW EXECUTE FUNCTION "luke_sync_automation"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "automation" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."scope" IS DISTINCT FROM NEW."scope" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."enabled" IS DISTINCT FROM NEW."enabled" OR OLD."trigger_kind" IS DISTINCT FROM NEW."trigger_kind" OR OLD."trigger" IS DISTINCT FROM NEW."trigger" OR OLD."action" IS DISTINCT FROM NEW."action" OR OLD."guards" IS DISTINCT FROM NEW."guards" OR OLD."next_run_at" IS DISTINCT FROM NEW."next_run_at" OR OLD."webhook_secret_hash" IS DISTINCT FROM NEW."webhook_secret_hash" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."target_kind" IS DISTINCT FROM NEW."target_kind" OR OLD."target_agent_id" IS DISTINCT FROM NEW."target_agent_id" OR OLD."archive_successful" IS DISTINCT FROM NEW."archive_successful" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "luke_sync_automation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_automation_run"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "automation"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "automation"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "automation"."id" = OLD."automation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "automation"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "automation"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "automation"."id" = NEW."automation_id"
		), '[]');
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "automation_run" FOR EACH ROW EXECUTE FUNCTION "luke_sync_automation_run"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "automation_run" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."dedupe_key" IS DISTINCT FROM NEW."dedupe_key" OR OLD."firing" IS DISTINCT FROM NEW."firing" OR OLD."payload" IS DISTINCT FROM NEW."payload" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."reason" IS DISTINCT FROM NEW."reason" OR OLD."coding_agent_id" IS DISTINCT FROM NEW."coding_agent_id" OR OLD."fired_at" IS DISTINCT FROM NEW."fired_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."claimed_agent_id" IS DISTINCT FROM NEW."claimed_agent_id" OR OLD."archive_settled_at" IS DISTINCT FROM NEW."archive_settled_at") EXECUTE FUNCTION "luke_sync_automation_run"();
