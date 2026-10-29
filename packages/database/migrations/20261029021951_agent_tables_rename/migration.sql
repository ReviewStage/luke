-- The four tables' locks are taken as GitLab's with_lock_retries takes them
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- one LOCK in a fixed order, under a short lock_timeout of its own, and on a timeout the attempt's
-- subtransaction rolls back, letting go of every lock it took, and waits out a growing backoff holding
-- none before the next. Note that each attempt's timeout stays under Postgres's one-second
-- deadlock_timeout, so a live transaction caught waiting behind it is never the one aborted: this
-- attempt gives up first. Nothing else this migration does locks a table but these four.
SET LOCAL statement_timeout = '150s';
--> statement-breakpoint
DO $$
DECLARE
	attempt int := 0;
	deadline timestamptz := clock_timestamp() + interval '2 minutes';
BEGIN
	LOOP
		attempt := attempt + 1;
		BEGIN
			PERFORM set_config('lock_timeout', least(100 * attempt, 500) || 'ms', true);
			LOCK TABLE "coding_agent", "coding_agent_delegation", "coding_agent_runner_lease", "coding_agent_wakeup" IN ACCESS EXCLUSIVE MODE;
			RETURN;
		EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
			IF clock_timestamp() > deadline THEN
				RAISE;
			END IF;
		END;
		PERFORM pg_sleep(least(0.2 * attempt, 3) * (0.5 + random()));
	END LOOP;
END
$$;
--> statement-breakpoint
-- With the four locks held, no statement below waits on another; one that does gives up rather than
-- queueing live traffic behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "coding_agent_delegation" RENAME TO "agent_delegation";
--> statement-breakpoint
ALTER TABLE "coding_agent" RENAME TO "agent";
--> statement-breakpoint
ALTER TABLE "coding_agent_runner_lease" RENAME TO "agent_runner_lease";
--> statement-breakpoint
ALTER TABLE "coding_agent_wakeup" RENAME TO "agent_wakeup";
--> statement-breakpoint
ALTER INDEX "coding_agent_user_idempotency" RENAME TO "agent_user_idempotency";
--> statement-breakpoint
ALTER INDEX "coding_agent_task_created" RENAME TO "agent_task_created";
--> statement-breakpoint
ALTER INDEX "coding_agent_conversation" RENAME TO "agent_conversation";
--> statement-breakpoint
ALTER INDEX "coding_agent_org_created" RENAME TO "agent_org_created";
--> statement-breakpoint
ALTER INDEX "coding_agent_org_taskless_created" RENAME TO "agent_org_taskless_created";
--> statement-breakpoint
ALTER INDEX "coding_agent_started_from_agent" RENAME TO "agent_started_from_agent";
--> statement-breakpoint
ALTER INDEX "coding_agent_runner_token_hash" RENAME TO "agent_runner_token_hash";
--> statement-breakpoint
ALTER INDEX "coding_agent_member_operator" RENAME TO "agent_member_operator";
--> statement-breakpoint
ALTER INDEX "coding_agent_wakeup_due" RENAME TO "agent_wakeup_due";
--> statement-breakpoint
ALTER INDEX "coding_agent_wakeup_agent" RENAME TO "agent_wakeup_agent";
--> statement-breakpoint
ALTER TABLE "agent_delegation" RENAME CONSTRAINT "coding_agent_delegation_child_conversation_id_conversations_id_" TO "agent_delegation_child_conversation_id_conversations_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_automation_id_automation_id_fkey" TO "agent_automation_id_automation_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_conversation_id_conversations_id_fk" TO "agent_conversation_id_conversations_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_device_id_device_id_fkey" TO "agent_device_id_device_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_organization_id_organization_id_fkey" TO "agent_organization_id_organization_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_pkey" TO "agent_pkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_plan_id_plan_id_fk" TO "agent_task_id_task_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_started_by_agent_id_coding_agent_id_fkey" TO "agent_started_by_agent_id_agent_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent" RENAME CONSTRAINT "coding_agent_user_id_user_id_fk" TO "agent_user_id_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent_delegation" RENAME CONSTRAINT "coding_agent_delegation_pkey" TO "agent_delegation_pkey";
--> statement-breakpoint
ALTER TABLE "agent_runner_lease" RENAME CONSTRAINT "coding_agent_runner_lease_agent_id_coding_agent_id_fkey" TO "agent_runner_lease_agent_id_agent_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent_runner_lease" RENAME CONSTRAINT "coding_agent_runner_lease_pkey" TO "agent_runner_lease_pkey";
--> statement-breakpoint
ALTER TABLE "agent_wakeup" RENAME CONSTRAINT "coding_agent_wakeup_agent_id_coding_agent_id_fkey" TO "agent_wakeup_agent_id_agent_id_fkey";
--> statement-breakpoint
ALTER TABLE "agent_wakeup" RENAME CONSTRAINT "coding_agent_wakeup_pkey" TO "agent_wakeup_pkey";
--> statement-breakpoint
DO $$
DECLARE
	named record;
BEGIN
	-- Postgres 18 names each NOT NULL constraint after its table as it was then.
	FOR named IN
		SELECT conrelid::regclass AS relation, conname FROM pg_constraint
		WHERE contype = 'n' AND conname LIKE 'coding\_agent%'
			AND conrelid IN ('"agent"'::regclass, '"agent_delegation"'::regclass, '"agent_runner_lease"'::regclass, '"agent_wakeup"'::regclass)
	LOOP
		EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', named.relation, named.conname, substr(named.conname, 8));
	END LOOP;
END
$$;
--> statement-breakpoint
-- The triggers followed their tables; they are dropped here so the capture is rendered afresh below.
DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_delegation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_delegation";
--> statement-breakpoint
DROP FUNCTION "luke_sync_coding_agent"();
--> statement-breakpoint
DROP FUNCTION "luke_sync_coding_agent_delegation"();
--> statement-breakpoint
-- The release before this one still names the old tables, for up to an hour after this deploy; each
-- view is a plain one over its table, so Postgres writes through it, and a later migration drops them.
CREATE VIEW "coding_agent" AS SELECT * FROM "agent";
--> statement-breakpoint
CREATE VIEW "coding_agent_delegation" AS SELECT * FROM "agent_delegation";
--> statement-breakpoint
CREATE VIEW "coding_agent_runner_lease" AS SELECT * FROM "agent_runner_lease";
--> statement-breakpoint
CREATE VIEW "coding_agent_wakeup" AS SELECT * FROM "agent_wakeup";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."id"::text), jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."id"::text), jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."automation_origin" IS DISTINCT FROM NEW."automation_origin" OR OLD."started_from" IS DISTINCT FROM NEW."started_from" OR OLD."started_by_agent_id" IS DISTINCT FROM NEW."started_by_agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort" OR OLD."context_window" IS DISTINCT FROM NEW."context_window" OR OLD."plan_snapshot" IS DISTINCT FROM NEW."plan_snapshot" OR OLD."prompt" IS DISTINCT FROM NEW."prompt" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."branch" IS DISTINCT FROM NEW."branch" OR OLD."start_branch" IS DISTINCT FROM NEW."start_branch" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."compacted_at" IS DISTINCT FROM NEW."compacted_at" OR OLD."published" IS DISTINCT FROM NEW."published" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at" OR OLD."archived_by" IS DISTINCT FROM NEW."archived_by" OR OLD."disabled_servers" IS DISTINCT FROM NEW."disabled_servers" OR OLD."mentioned_servers" IS DISTINCT FROM NEW."mentioned_servers" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."payer" IS DISTINCT FROM NEW."payer" OR OLD."runner_token_hash" IS DISTINCT FROM NEW."runner_token_hash" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "luke_sync_agent"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent_delegation"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent_delegation" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent_delegation"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent_delegation" FOR EACH ROW WHEN (OLD."child_conversation_id" IS DISTINCT FROM NEW."child_conversation_id" OR OLD."call_id" IS DISTINCT FROM NEW."call_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort") EXECUTE FUNCTION "luke_sync_agent_delegation"();
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
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "agent"."id"::text)), (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."conversation_id" = OLD."conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "agent"."id"::text)), (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."conversation_id" = NEW."conversation_id"
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
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
