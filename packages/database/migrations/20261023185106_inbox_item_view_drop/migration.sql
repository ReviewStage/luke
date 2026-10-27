-- contract: an inbox item's blocks, response, and answer were the view of its thread a desktop before inbox wire version 5 read; every item is a thread since 20261023183614_inbox_item_pre_v5_threads, nothing reads them, and no desktop in use draws them, so they go
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "blocks";--> statement-breakpoint
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "response";--> statement-breakpoint
ALTER TABLE "inbox_item" DROP COLUMN IF EXISTS "answer";
