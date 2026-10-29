-- The last of the "coding agent" names: the foreign keys other tables hold to `agent`, named after
-- the table it was. Nothing reads a constraint's name, so this is cosmetic, but renaming one locks
-- its table, so the twelve tables are locked first, as 20261029021951_agent_tables_rename locks its
-- own, after GitLab's with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- one LOCK in a fixed order, under a short lock_timeout of its own, letting every lock go and backing
-- off holding none between attempts. Each rename is guarded, so a database that ran it already runs
-- it again cleanly.
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
			LOCK TABLE "automation", "device_agent_line", "device_agent_request", "inbox_item", "operator_notice", "operator_wake", "plan_comment", "plan_page_version", "plan_revision", "runner_line", "task", "token_pull_request_poll" IN ACCESS EXCLUSIVE MODE;
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
DO $$
DECLARE
	renamed record;
BEGIN
	FOR renamed IN
		SELECT * FROM (VALUES
			('automation', 'automation_target_agent_id_coding_agent_id_fkey', 'automation_target_agent_id_agent_id_fkey'),
			('device_agent_line', 'device_agent_line_agent_id_coding_agent_id_fkey', 'device_agent_line_agent_id_agent_id_fkey'),
			('device_agent_request', 'device_agent_request_agent_id_coding_agent_id_fkey', 'device_agent_request_agent_id_agent_id_fkey'),
			('inbox_item', 'inbox_item_agent_id_coding_agent_id_fk', 'inbox_item_agent_id_agent_id_fkey'),
			('operator_notice', 'operator_notice_agent_id_coding_agent_id_fkey', 'operator_notice_agent_id_agent_id_fkey'),
			('operator_notice', 'operator_notice_operator_id_coding_agent_id_fkey', 'operator_notice_operator_id_agent_id_fkey'),
			('operator_wake', 'operator_wake_agent_id_coding_agent_id_fkey', 'operator_wake_agent_id_agent_id_fkey'),
			('operator_wake', 'operator_wake_operator_id_coding_agent_id_fkey', 'operator_wake_operator_id_agent_id_fkey'),
			('plan_comment', 'plan_comment_agent_id_coding_agent_id_fkey', 'plan_comment_agent_id_agent_id_fkey'),
			('plan_comment', 'plan_comment_asked_agent_id_coding_agent_id_fkey', 'plan_comment_asked_agent_id_agent_id_fkey'),
			('plan_page_version', 'plan_page_version_agent_id_coding_agent_id_fkey', 'plan_page_version_agent_id_agent_id_fkey'),
			('plan_revision', 'plan_revision_agent_id_coding_agent_id_fk', 'plan_revision_agent_id_agent_id_fkey'),
			('runner_line', 'runner_line_agent_id_coding_agent_id_fkey', 'runner_line_agent_id_agent_id_fkey'),
			('task', 'task_creator_agent_id_coding_agent_id_fkey', 'task_creator_agent_id_agent_id_fkey'),
			('token_pull_request_poll', 'token_pull_request_poll_agent_id_coding_agent_id_fkey', 'token_pull_request_poll_agent_id_agent_id_fkey')
		) AS "rename"("relation", "old", "new")
	LOOP
		IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = renamed.relation::regclass AND conname = renamed.old) THEN
			EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', renamed.relation, renamed.old, renamed.new);
		END IF;
	END LOOP;
END
$$;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
