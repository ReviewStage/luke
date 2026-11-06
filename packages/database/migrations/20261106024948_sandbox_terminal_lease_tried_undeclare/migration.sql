-- Expand step of dropping the Terminal lease's "tried_at": the module no longer declares it, and nothing this
-- deployment runs reads or writes it, since the scheduled sweep that claimed a lapsed lease and stamped it is
-- gone and Vercel's own timeout stops a sandbox no one types in. Its index, which only that sweep's read used,
-- goes now. Note that the column itself stays one deployment longer, because a build migrates while the
-- deployment before it still serves and its lease write clears the stamp; a later release's migration drops it
-- (apps/web/server/README.md, "Dropping a column ... takes two deployments"). It is nullable, so this
-- deployment's inserts, which name it no longer, still succeed while it stands.
DROP INDEX IF EXISTS "sandbox_terminal_lease_next";
