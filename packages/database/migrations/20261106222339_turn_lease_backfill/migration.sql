-- Every turn still open as the lease arrives takes one from now, so a turn the
-- retired sweep would have settled is read as lost once it runs out, rather than
-- standing open for good with no lease to run out.
UPDATE "turns" SET "lease_until" = now() + interval '15 minutes'
WHERE "status" IN ('queued', 'running') AND "lease_until" IS NULL;
