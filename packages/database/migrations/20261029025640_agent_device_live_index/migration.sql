-- A preview database may hold this index from an earlier folder name with a wider predicate, so it is made again.
DROP INDEX IF EXISTS "agent_device_live";--> statement-breakpoint
CREATE INDEX "agent_device_live" ON "agent" ("device_id") WHERE "device_id" is not null and "archived_at" is null;
