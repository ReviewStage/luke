-- The contract of the "coding agent" → "agent" rename: no release still serving names a coding_agent*
-- table or column, or writes an agent's conversation as `coding_agent`, so what kept them working
-- for the deploys' overlap goes. Note that every drop and rename is guarded, so a preview database
-- that ran this migration under an earlier folder name runs it again cleanly.
--
-- The tables are locked first, as 20261029021951_agent_tables_rename locks them, after GitLab's
-- with_lock_retries (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- in one fixed order, under a short lock_timeout of its own, letting every lock go and backing off
-- holding none between attempts. Note that the four agent tables are among them because dropping
-- a view locks the table it reads. Nothing below locks a table but these eight.
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
			LOCK TABLE "agent", "agent_delegation", "agent_runner_lease", "agent_wakeup", "account_preference", "agent_pin", "agent_section_entry", "automation_run" IN ACCESS EXCLUSIVE MODE;
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
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
-- Then the conversations either earlier release left as `coding_agent`, which by now are only the
-- few the kind's first rewrite skipped and those its release wrote while it served. Note that this
-- comes after the table locks rather than before, because the deploy runs every migration in one
-- transaction: a row rewritten before the lock loop would stay locked through its retries. A row a
-- live transaction holds is waited on under a lock_timeout below the one-second deadlock check, so
-- the deploy rather than that transaction gives up.
SET LOCAL lock_timeout = '500ms';
--> statement-breakpoint
UPDATE "conversations" SET "kind" = 'agent' WHERE "kind" = 'coding_agent';
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DROP VIEW IF EXISTS "coding_agent";
--> statement-breakpoint
DROP VIEW IF EXISTS "coding_agent_delegation";
--> statement-breakpoint
DROP VIEW IF EXISTS "coding_agent_runner_lease";
--> statement-breakpoint
DROP VIEW IF EXISTS "coding_agent_wakeup";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agent_id_mirror" ON "agent_pin";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agent_id_mirror" ON "agent_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agent_id_mirror" ON "automation_run";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agent_choice_mirror" ON "account_preference";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "agent_id_mirror"();
--> statement-breakpoint
DROP FUNCTION IF EXISTS "agent_choice_mirror"();
--> statement-breakpoint
-- Each old column goes with its foreign key and the unique index that stood in for its old key.
ALTER TABLE "agent_pin" DROP COLUMN IF EXISTS "coding_agent_id";
--> statement-breakpoint
ALTER TABLE "agent_section_entry" DROP COLUMN IF EXISTS "coding_agent_id";
--> statement-breakpoint
ALTER TABLE "automation_run" DROP COLUMN IF EXISTS "coding_agent_id";
--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN IF EXISTS "coding_agent_model";
--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN IF EXISTS "coding_agent_effort";
--> statement-breakpoint
ALTER TABLE "account_preference" DROP COLUMN IF EXISTS "coding_agent_context_window";
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_run_claimed_agent_id_coding_agent_id_fkey') THEN
		ALTER TABLE "automation_run" RENAME CONSTRAINT "automation_run_claimed_agent_id_coding_agent_id_fkey" TO "automation_run_claimed_agent_id_agent_id_fkey";
	END IF;
END
$$;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
