-- Every turn still open as the lease arrives takes one from now, so a turn the
-- retired sweep would have settled is read as lost once it runs out, rather than
-- standing open for good with no lease to run out. Note that it runs in the run's
-- one transaction after 20261106222322_turn_lease, which already holds the turns
-- table's lock, so it waits on nothing; it touches only the open turns, a few rows.
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
UPDATE "turns" SET "lease_until" = now() + interval '15 minutes'
WHERE "status" IN ('queued', 'running') AND "lease_until" IS NULL;
--> statement-breakpoint
SET LOCAL statement_timeout TO DEFAULT;
