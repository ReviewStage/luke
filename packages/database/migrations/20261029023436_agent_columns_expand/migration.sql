-- The tables this migration alters are locked as GitLab's with_lock_retries locks them
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks),
-- as 20261029021951_agent_tables_rename does: in one fixed order, under a short lock_timeout of
-- its own, and on a timeout the attempt's subtransaction rolls back, letting go of every lock it
-- took, and waits out a growing backoff holding none before the next. The agent table is locked
-- only against writes, which is what a new foreign key to it takes; the four whose columns change
-- are locked outright. Nothing else this migration does locks a table but these five.
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
			LOCK TABLE "agent" IN SHARE ROW EXCLUSIVE MODE;
			LOCK TABLE "account_preference", "agent_pin", "agent_section_entry", "automation_run" IN ACCESS EXCLUSIVE MODE;
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
-- With the locks held, no statement below waits on another; one that does gives up rather than
-- queueing live traffic behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "agent_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "agent_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_update" ON "automation_run";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "luke_sync_write" ON "automation_run";
--> statement-breakpoint
-- The release before this one still reads and writes the coding_agent* columns for up to an hour
-- after this deploy, so they stand beside the new ones until a later migration drops them, and a
-- trigger keeps each pair equal whichever release wrote: a write that moves one moves the other.
ALTER TABLE "agent_pin" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_section_entry" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "account_preference" ADD COLUMN "agent_model" text;--> statement-breakpoint
ALTER TABLE "account_preference" ADD COLUMN "agent_effort" text;--> statement-breakpoint
ALTER TABLE "account_preference" ADD COLUMN "agent_context_window" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "agent_id_mirror"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		NEW."agent_id" := coalesce(NEW."agent_id", NEW."coding_agent_id");
		NEW."coding_agent_id" := coalesce(NEW."coding_agent_id", NEW."agent_id");
	ELSIF NEW."agent_id" IS DISTINCT FROM OLD."agent_id" THEN
		NEW."coding_agent_id" := NEW."agent_id";
	ELSIF NEW."coding_agent_id" IS DISTINCT FROM OLD."coding_agent_id" THEN
		NEW."agent_id" := NEW."coding_agent_id";
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "agent_choice_mirror"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."agent_model" IS NULL AND NEW."agent_effort" IS NULL AND NEW."agent_context_window" IS NULL THEN
			NEW."agent_model" := NEW."coding_agent_model";
			NEW."agent_effort" := NEW."coding_agent_effort";
			NEW."agent_context_window" := NEW."coding_agent_context_window";
		ELSE
			NEW."coding_agent_model" := NEW."agent_model";
			NEW."coding_agent_effort" := NEW."agent_effort";
			NEW."coding_agent_context_window" := NEW."agent_context_window";
		END IF;
	ELSIF (NEW."agent_model", NEW."agent_effort", NEW."agent_context_window") IS DISTINCT FROM (OLD."agent_model", OLD."agent_effort", OLD."agent_context_window") THEN
		NEW."coding_agent_model" := NEW."agent_model";
		NEW."coding_agent_effort" := NEW."agent_effort";
		NEW."coding_agent_context_window" := NEW."agent_context_window";
	ELSIF (NEW."coding_agent_model", NEW."coding_agent_effort", NEW."coding_agent_context_window") IS DISTINCT FROM (OLD."coding_agent_model", OLD."coding_agent_effort", OLD."coding_agent_context_window") THEN
		NEW."agent_model" := NEW."coding_agent_model";
		NEW."agent_effort" := NEW."coding_agent_effort";
		NEW."agent_context_window" := NEW."coding_agent_context_window";
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "agent_id_mirror" BEFORE INSERT OR UPDATE ON "agent_pin" FOR EACH ROW EXECUTE FUNCTION "agent_id_mirror"();--> statement-breakpoint
CREATE TRIGGER "agent_id_mirror" BEFORE INSERT OR UPDATE ON "agent_section_entry" FOR EACH ROW EXECUTE FUNCTION "agent_id_mirror"();--> statement-breakpoint
CREATE TRIGGER "agent_id_mirror" BEFORE INSERT OR UPDATE ON "automation_run" FOR EACH ROW EXECUTE FUNCTION "agent_id_mirror"();--> statement-breakpoint
CREATE TRIGGER "agent_choice_mirror" BEFORE INSERT OR UPDATE ON "account_preference" FOR EACH ROW EXECUTE FUNCTION "agent_choice_mirror"();--> statement-breakpoint
UPDATE "agent_pin" SET "agent_id" = "coding_agent_id" WHERE "agent_id" IS DISTINCT FROM "coding_agent_id";--> statement-breakpoint
UPDATE "agent_section_entry" SET "agent_id" = "coding_agent_id" WHERE "agent_id" IS DISTINCT FROM "coding_agent_id";--> statement-breakpoint
UPDATE "automation_run" SET "agent_id" = "coding_agent_id" WHERE "agent_id" IS DISTINCT FROM "coding_agent_id";--> statement-breakpoint
UPDATE "account_preference" SET "agent_model" = "coding_agent_model", "agent_effort" = "coding_agent_effort", "agent_context_window" = "coding_agent_context_window"
	WHERE ("agent_model", "agent_effort", "agent_context_window") IS DISTINCT FROM ("coding_agent_model", "coding_agent_effort", "coding_agent_context_window");--> statement-breakpoint
ALTER TABLE "agent_pin" ALTER COLUMN "agent_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_section_entry" ALTER COLUMN "agent_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_pin" ADD CONSTRAINT "agent_pin_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_section_entry" ADD CONSTRAINT "agent_section_entry_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
-- The old keys stand as unique indexes, which the release before this one names in its ON CONFLICT.
CREATE UNIQUE INDEX "agent_pin_user_coding_agent" ON "agent_pin" ("user_id","coding_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_section_entry_user_coding_agent" ON "agent_section_entry" ("user_id","coding_agent_id");--> statement-breakpoint
ALTER TABLE "agent_pin" DROP CONSTRAINT "agent_pin_pkey";--> statement-breakpoint
ALTER TABLE "agent_section_entry" DROP CONSTRAINT "agent_section_entry_pkey";--> statement-breakpoint
ALTER TABLE "agent_pin" ADD PRIMARY KEY ("user_id","agent_id");--> statement-breakpoint
ALTER TABLE "agent_section_entry" ADD PRIMARY KEY ("user_id","agent_id");--> statement-breakpoint
DROP INDEX "agent_pin_agent";--> statement-breakpoint
CREATE INDEX "agent_pin_agent" ON "agent_pin" ("agent_id");--> statement-breakpoint
DROP INDEX "agent_section_entry_agent";--> statement-breakpoint
CREATE INDEX "agent_section_entry_agent" ON "agent_section_entry" ("agent_id");--> statement-breakpoint
DROP INDEX "automation_run_unrecorded_settled";--> statement-breakpoint
CREATE INDEX "automation_run_unrecorded_settled" ON "automation_run" ("status","settled_at") WHERE "agent_id" is null;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent_pin"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent_pin" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent_pin"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent_pin" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."pinned_at" IS DISTINCT FROM NEW."pinned_at") EXECUTE FUNCTION "luke_sync_agent_pin"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "luke_sync_agent_section_entry"() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "luke_sync_write" AFTER INSERT OR DELETE ON "agent_section_entry" FOR EACH ROW EXECUTE FUNCTION "luke_sync_agent_section_entry"();
--> statement-breakpoint
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "agent_section_entry" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."section_id" IS DISTINCT FROM NEW."section_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."added_at" IS DISTINCT FROM NEW."added_at") EXECUTE FUNCTION "luke_sync_agent_section_entry"();
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
CREATE TRIGGER "luke_sync_update" AFTER UPDATE ON "automation_run" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."dedupe_key" IS DISTINCT FROM NEW."dedupe_key" OR OLD."firing" IS DISTINCT FROM NEW."firing" OR OLD."payload" IS DISTINCT FROM NEW."payload" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."reason" IS DISTINCT FROM NEW."reason" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."fired_at" IS DISTINCT FROM NEW."fired_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."claimed_agent_id" IS DISTINCT FROM NEW."claimed_agent_id" OR OLD."archive_settled_at" IS DISTINCT FROM NEW."archive_settled_at") EXECUTE FUNCTION "luke_sync_automation_run"();
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
