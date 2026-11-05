-- GitHub's deliveries find the agents on a branch or a pull request by the repository lowercased and the
-- branch exactly, on the agent row and on its extra repositories' rows. The migrator runs every folder
-- inside one transaction, so CONCURRENTLY is unavailable here. agent_repository is days old and holds a
-- handful of rows. The agent index is partial, over the agents that opened a pull request alone, so its
-- build reads the table once and writes few entries, but it holds the agent's SHARE lock while it builds,
-- which blocks the writes every turn makes, so the lock is taken first as
-- 20261105035140_task_agent_read takes its locks, after GitLab's with_lock_retries
-- (https://docs.gitlab.com/development/migration_style_guide/#retry-mechanism-when-acquiring-database-locks):
-- under a short lock_timeout of its own, letting it go and backing off holding none between attempts, so
-- no turn's write queues behind a build waiting on a long transaction.
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
			LOCK TABLE "agent" IN SHARE MODE;
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
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_on_branch" ON "agent" (lower("repository"),"branch") WHERE "branch" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_repository_on_head" ON "agent_repository" (lower("repository"),"head_branch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_repository_on_pull_request" ON "agent_repository" (lower("repository"),(("published"->>'number')::int));
