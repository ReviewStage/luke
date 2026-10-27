DROP INDEX "inbox_item_channel_posted";--> statement-breakpoint
CREATE INDEX "inbox_item_channel_updated" ON "inbox_item" ("channel_id","updated_at");