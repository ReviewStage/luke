DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent";
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "automation_run_id" uuid;--> statement-breakpoint
CREATE INDEX "agent_automation_run" ON "agent" ("automation_run_id") WHERE "automation_run_id" is not null;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_automation_run_id_automation_run_id_fkey" FOREIGN KEY ("automation_run_id") REFERENCES "automation_run"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Each agent belongs to the run that started it: the run whose id it was started under, never the
-- run of an automation that hands every run to the same agent, which names an agent it did not start.
UPDATE "agent" SET "automation_run_id" = "automation_run"."id" FROM "automation_run" WHERE "automation_run"."agent_id" = "agent"."id" AND "agent"."idempotency_key" = "automation_run"."id"::text;
--> statement-breakpoint
-- And an agent a run's agent started with no task belongs to that run too, down every chain of
-- starters; one started onto a task is that task's, and the walk stops below it. Note that the walk
-- takes UNION rather than UNION ALL, because a pilot's takeover moves its agents' starter, and a chain
-- that comes back on itself must end rather than loop.
WITH RECURSIVE "owned" ("id", "automation_run_id") AS (SELECT "id", "automation_run_id" FROM "agent" WHERE "automation_run_id" IS NOT NULL UNION SELECT "child"."id", "owned"."automation_run_id" FROM "agent" AS "child" INNER JOIN "owned" ON "child"."started_by_agent_id" = "owned"."id" WHERE "child"."automation_run_id" IS NULL AND "child"."task_id" IS NULL) UPDATE "agent" SET "automation_run_id" = "owned"."automation_run_id" FROM "owned" WHERE "agent"."id" = "owned"."id" AND "agent"."automation_run_id" IS NULL;
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
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."automation_run_id" IS DISTINCT FROM NEW."automation_run_id" OR OLD."automation_origin" IS DISTINCT FROM NEW."automation_origin" OR OLD."started_from" IS DISTINCT FROM NEW."started_from" OR OLD."started_by_agent_id" IS DISTINCT FROM NEW."started_by_agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort" OR OLD."context_window" IS DISTINCT FROM NEW."context_window" OR OLD."plan_snapshot" IS DISTINCT FROM NEW."plan_snapshot" OR OLD."prompt" IS DISTINCT FROM NEW."prompt" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."repositories" IS DISTINCT FROM NEW."repositories" OR OLD."branch" IS DISTINCT FROM NEW."branch" OR OLD."start_branch" IS DISTINCT FROM NEW."start_branch" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."compacted_at" IS DISTINCT FROM NEW."compacted_at" OR OLD."published" IS DISTINCT FROM NEW."published" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at" OR OLD."archived_by" IS DISTINCT FROM NEW."archived_by" OR OLD."disabled_servers" IS DISTINCT FROM NEW."disabled_servers" OR OLD."mentioned_servers" IS DISTINCT FROM NEW."mentioned_servers" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."payer" IS DISTINCT FROM NEW."payer" OR OLD."runner_token_hash" IS DISTINCT FROM NEW."runner_token_hash" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "luke_sync_agent"();
