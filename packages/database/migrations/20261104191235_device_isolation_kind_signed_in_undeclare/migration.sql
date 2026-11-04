-- Expand step of dropping the device's "isolation", "kind", and "signed_in": the modules no longer
-- declare them, and nothing this deployment runs reads or writes them. Note that the columns themselves
-- stay one deployment longer, because a build migrates while the deployment before it still serves and
-- still writes them; a later release's migration drops them (apps/web/server/README.md, "Dropping a column
-- ... takes two deployments"). "kind" is the one of them with no default, so it drops its NOT NULL here,
-- or this deployment's inserts, which name it no longer, would fail while it stands.
ALTER TABLE "device" ALTER COLUMN "kind" DROP NOT NULL;
--> statement-breakpoint
-- Note that a row may still name the retired "agent-state" capability, which this deployment's read of a
-- device's capabilities refuses, so it is taken out of every row that names it.
UPDATE "device" SET "capabilities" = array_remove("capabilities", 'agent-state') WHERE 'agent-state' = ANY("capabilities");
