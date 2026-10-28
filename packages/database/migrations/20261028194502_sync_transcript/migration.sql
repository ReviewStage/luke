DROP TRIGGER IF EXISTS "luke_sync_update" ON "messages";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "messages";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "conversations";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "conversations";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "turns";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "turns";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "asks";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "asks";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "coding_agent_delegation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "coding_agent_delegation";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_messages"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "messages" FOR EACH ROW EXECUTE FUNCTION "luke_sync_messages"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "messages" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."client_id" IS DISTINCT FROM NEW."client_id" OR OLD."role" IS DISTINCT FROM NEW."role" OR OLD."parts" IS DISTINCT FROM NEW."parts" OR OLD."metadata" IS DISTINCT FROM NEW."metadata" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."finished_at" IS DISTINCT FROM NEW."finished_at" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."placed_at" IS DISTINCT FROM NEW."placed_at" OR OLD."sender" IS DISTINCT FROM NEW."sender" OR OLD."sender_user_id" IS DISTINCT FROM NEW."sender_user_id" OR OLD."sender_name" IS DISTINCT FROM NEW."sender_name" OR OLD."sender_model" IS DISTINCT FROM NEW."sender_model" OR OLD."sender_agent_id" IS DISTINCT FROM NEW."sender_agent_id" OR OLD."taken_after_step" IS DISTINCT FROM NEW."taken_after_step" OR OLD."withdrawn_at" IS DISTINCT FROM NEW."withdrawn_at") EXECUTE FUNCTION "luke_sync_messages"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_conversations"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."id"::text), jsonb_build_array('conversation', OLD."parent_conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."id"::text), jsonb_build_array('conversation', NEW."parent_conversation_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "conversations" FOR EACH ROW EXECUTE FUNCTION "luke_sync_conversations"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "conversations" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."parent_conversation_id" IS DISTINCT FROM NEW."parent_conversation_id" OR OLD."runtime_session_id" IS DISTINCT FROM NEW."runtime_session_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" OR OLD."journal_revision" IS DISTINCT FROM NEW."journal_revision" OR OLD."label" IS DISTINCT FROM NEW."label" OR OLD."expects_completion" IS DISTINCT FROM NEW."expects_completion" OR OLD."runtime" IS DISTINCT FROM NEW."runtime" OR OLD."native_session" IS DISTINCT FROM NEW."native_session" OR OLD."rewound_revision" IS DISTINCT FROM NEW."rewound_revision" OR OLD."native_rewind" IS DISTINCT FROM NEW."native_rewind" OR OLD."native_handed" IS DISTINCT FROM NEW."native_handed") EXECUTE FUNCTION "luke_sync_conversations"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_turns"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "coding_agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "coding_agent"."id"::text)), (jsonb_build_array('task', "coding_agent"."task_id"::text)), (jsonb_build_array('workspace', "coding_agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "coding_agent"."conversation_id" = OLD."conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "coding_agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "coding_agent"."id"::text)), (jsonb_build_array('task', "coding_agent"."task_id"::text)), (jsonb_build_array('workspace', "coding_agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "coding_agent"."conversation_id" = NEW."conversation_id"
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "turns" FOR EACH ROW EXECUTE FUNCTION "luke_sync_turns"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "turns" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."origin" IS DISTINCT FROM NEW."origin" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."reasoning_effort" IS DISTINCT FROM NEW."reasoning_effort" OR OLD."prompt_hash" IS DISTINCT FROM NEW."prompt_hash" OR OLD."tool_set_hash" IS DISTINCT FROM NEW."tool_set_hash" OR OLD."response_ids" IS DISTINCT FROM NEW."response_ids" OR OLD."usage" IS DISTINCT FROM NEW."usage" OR OLD."eve_turn_id" IS DISTINCT FROM NEW."eve_turn_id" OR OLD."queued_at" IS DISTINCT FROM NEW."queued_at" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."failure" IS DISTINCT FROM NEW."failure" OR OLD."failure_detail" IS DISTINCT FROM NEW."failure_detail" OR OLD."cancel_requested_at" IS DISTINCT FROM NEW."cancel_requested_at" OR OLD."cancel_request_key" IS DISTINCT FROM NEW."cancel_request_key" OR OLD."fast_refused" IS DISTINCT FROM NEW."fast_refused") EXECUTE FUNCTION "luke_sync_turns"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_asks"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "asks" FOR EACH ROW EXECUTE FUNCTION "luke_sync_asks"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "asks" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."client_id" IS DISTINCT FROM NEW."client_id" OR OLD."origin" IS DISTINCT FROM NEW."origin" OR OLD."session_id" IS DISTINCT FROM NEW."session_id" OR OLD."delivery_id" IS DISTINCT FROM NEW."delivery_id" OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."cancel_requested_at" IS DISTINCT FROM NEW."cancel_requested_at" OR OLD."joined_after_step" IS DISTINCT FROM NEW."joined_after_step") EXECUTE FUNCTION "luke_sync_asks"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_coding_agent_delegation"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "conversations"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('conversation', "conversations"."parent_conversation_id"::text))) AS "sync_lookup"("topic")
			WHERE "conversations"."id" = OLD."child_conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "conversations"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('conversation', "conversations"."parent_conversation_id"::text))) AS "sync_lookup"("topic")
			WHERE "conversations"."id" = NEW."child_conversation_id"
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "coding_agent_delegation" FOR EACH ROW EXECUTE FUNCTION "luke_sync_coding_agent_delegation"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "coding_agent_delegation" FOR EACH ROW WHEN (OLD."child_conversation_id" IS DISTINCT FROM NEW."child_conversation_id" OR OLD."call_id" IS DISTINCT FROM NEW."call_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort") EXECUTE FUNCTION "luke_sync_coding_agent_delegation"();
