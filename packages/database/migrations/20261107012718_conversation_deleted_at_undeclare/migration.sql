-- Expand step of dropping the conversation's "deleted_at": the module no longer declares it, and nothing this
-- deployment runs reads or writes it, since a deleted task's or agent's conversations, and the workers a rewind
-- drops, are now deleted at once (models/conversation-delete.ts) rather than stamped and purged by the scheduled
-- sweep seven days later. Note that the column itself stays one deployment longer, because a build migrates
-- while the deployment before it still serves, stamps it, and reads past every stamped row; a later release's
-- migration drops it (apps/web/server/README.md, "Dropping a column ... takes two deployments"), with the
-- "conversations_deleted_at" index and "conversations_standing_main" (declared again without it) that name it,
-- so its DROP INDEX is emptied out of this file as its DROP COLUMN is. It has no default but null, so this
-- deployment's inserts, which name it no longer, leave every row it writes unstamped, and a rollback's purge,
-- which takes only rows stamped a week ago, deletes nothing of them.
--
-- Every conversation stamped so far is deleted here, its messages, turns, events, and workers by the schema's
-- cascade, because this deployment reads past no stamp and would show them again. Note that a row the previous
-- deployment stamps after this commits, while it still serves, stands until the drop's migration deletes it
-- the same way. The delete takes only ROW EXCLUSIVE, which no ordinary write waits on, and production held 37
-- stamped conversations with 174 messages on 2026-11-07, so it is bounded by a short statement_timeout; the
-- lock is still taken first under the retry below, since a concurrent DDL statement could hold the table.
--
-- The table's capture is then rendered again without the column (src/sync/render.ts), since a trigger whose
-- WHEN names a column is what a later DROP COLUMN would refuse over. Swapping its triggers takes ACCESS
-- EXCLUSIVE on a table written by every turn, so that lock is taken last, after the delete, and held only for
-- the swap until the batch commits; both locks are taken as 20261105152259_agent_drop_repositories takes its
-- own, after GitLab's with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- each attempt under a short lock_timeout of its own, letting the lock go and backing off holding none between
-- attempts.
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
			LOCK TABLE "conversations" IN ROW EXCLUSIVE MODE;
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
-- With the lock held, no statement below waits on another; one that does gives up rather than
-- queueing live traffic behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
DELETE FROM "conversations" WHERE "deleted_at" IS NOT NULL;
--> statement-breakpoint
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
			LOCK TABLE "conversations" IN ACCESS EXCLUSIVE MODE;
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
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "conversations";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "conversations";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_conversations"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."id"::text), jsonb_build_array('conversation', OLD."parent_conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."id"::text), jsonb_build_array('conversation', NEW."parent_conversation_id"::text));
	END IF;
	IF TG_OP <> 'UPDATE' OR OLD."runtime_session_id" IS DISTINCT FROM NEW."runtime_session_id" THEN
		IF TG_OP <> 'INSERT' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
		END IF;
		IF TG_OP <> 'DELETE' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
		END IF;
		INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
			pg_current_xact_id()::text::bigint, 'conversations',
			(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),
			coalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "conversations" FOR EACH ROW EXECUTE FUNCTION "app_sync_conversations"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "conversations" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."parent_conversation_id" IS DISTINCT FROM NEW."parent_conversation_id" OR OLD."runtime_session_id" IS DISTINCT FROM NEW."runtime_session_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."journal_revision" IS DISTINCT FROM NEW."journal_revision" OR OLD."label" IS DISTINCT FROM NEW."label" OR OLD."expects_completion" IS DISTINCT FROM NEW."expects_completion" OR OLD."runtime" IS DISTINCT FROM NEW."runtime" OR OLD."native_session" IS DISTINCT FROM NEW."native_session" OR OLD."rewound_revision" IS DISTINCT FROM NEW."rewound_revision" OR OLD."native_rewind" IS DISTINCT FROM NEW."native_rewind" OR OLD."native_handed" IS DISTINCT FROM NEW."native_handed") EXECUTE FUNCTION "app_sync_conversations"();
--> statement-breakpoint
-- Note that the settings go back with SET LOCAL rather than RESET, because RESET sets the session's value to the
-- server's default, which outlives this transaction and takes away the runner's own lock_timeout (migrator.ts's
-- MIGRATION_LOCK_TIMEOUT) from every later migration of the run. The 5s above is that bound already, so it stands.
SET LOCAL statement_timeout TO DEFAULT;
