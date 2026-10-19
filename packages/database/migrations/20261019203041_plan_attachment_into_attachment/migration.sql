-- contract: "plan_attachment" stays readable and writable as a view over "attachment", for runs still on a deployment from before this one; the table itself stands renamed "plan_attachment_moved", and a later migration drops it and the view once they have drained.
-- Idempotent: the copy and the rename run only while "plan_attachment" is still a table, so a preview database that ran this under an earlier draft folder name runs it again as a no-op.
-- "task" is locked first, against writes and row locks both, and then the two tables this changes: an old upload, save, sweep, task move, or task deletion starts at its task's row, so each either finishes before this or waits holding nothing, and the copy's check of each picture's task finds no row held. The copy names no workspace, which a chat post may hold a row of, and the column takes a null for a picture kept before the move; a task's move fills it. The one cycle left is an account deleted in the same moment that uploaded one of these pictures, which aborts one of the two to be run again. Reading every plan picture's bytes took 0.3 s on production's 37 pictures (14 MB). The old table is renamed rather than dropped, which locks no table its keys name.
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.plan_attachment')) = 'r' THEN
		LOCK TABLE "task" IN EXCLUSIVE MODE;
		LOCK TABLE "plan_attachment", "attachment" IN ACCESS EXCLUSIVE MODE;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_task" ON "attachment" ("task_id") WHERE "task_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_unsaved" ON "attachment" ("created_at") WHERE ("task_id" is not null and num_nonnulls("chat_message_id", "inbox_item_id") = 0) and "saved_at" is null;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_one_owner";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_one_owner" CHECK ((num_nonnulls("chat_message_id", "inbox_item_id") = 1 or ("task_id" is not null and num_nonnulls("chat_message_id", "inbox_item_id") = 0)) and ("inbox_message_id" is null or "inbox_item_id" is not null));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_bytes_bound";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_bytes_bound" CHECK (("chat_message_id" is null or octet_length("bytes") <= 1500000) and (not ("task_id" is not null and num_nonnulls("chat_message_id", "inbox_item_id") = 0) or octet_length("bytes") <= 1500000));--> statement-breakpoint
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.plan_attachment')) = 'r' THEN
		-- Each picture under its id, and no workspace, which the table did not keep either.
		INSERT INTO "attachment" ("id", "user_id", "task_id", "content_type", "byte_count", "bytes", "created_at", "saved_at")
			SELECT "id", "user_id", "task_id", "content_type", "byte_count", "bytes", "created_at", "saved_at" FROM "plan_attachment"
			ON CONFLICT ("id") DO NOTHING;
		-- Renamed rather than dropped: a drop takes locks on every table its foreign keys name, and a rename takes none. The table is dropped with the view, once no old writer stands.
		ALTER TABLE "plan_attachment" RENAME TO "plan_attachment_moved";
	END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE VIEW "plan_attachment" AS
	SELECT "id", "task_id", "user_id", "content_type", "byte_count", "bytes", "created_at", "saved_at"
	FROM "attachment"
	WHERE "task_id" IS NOT NULL AND num_nonnulls("chat_message_id", "inbox_item_id") = 0;--> statement-breakpoint
-- The default the table's id had, which an insert through the view that leaves it out takes.
ALTER VIEW "plan_attachment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
