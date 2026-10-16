-- The primary flag is unread from this deployment on, but its column stays
-- until the build that read it has drained; the one migration that dropped it
-- early, on a preview, is answered by putting it back. A database that kept
-- it, as every production one did, is left as it stands.
ALTER TABLE "integration_connection" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;
