-- The primary flag's column, unread since the deployment before this one, goes.
-- Run only once that deployment has drained, so no build still serving reads
-- it: this is the second half of retiring it, the first having stopped every
-- read and write.
ALTER TABLE "integration_connection" DROP COLUMN IF EXISTS "is_primary";
