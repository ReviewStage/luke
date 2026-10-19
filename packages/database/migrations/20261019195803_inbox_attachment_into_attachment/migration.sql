-- contract: "inbox_attachment" stays readable and writable as a view over "attachment", its "item_id" and "message_id" aliasing "inbox_item_id" and "inbox_message_id", for runs still on a deployment from before this one; the table itself stands renamed "inbox_attachment_moved", and a later migration drops it and the view once they have drained.
-- Idempotent: the copy and the rename run only while "inbox_attachment" is still a table, so a preview database that ran this under an earlier draft folder name runs it again as a no-op.
-- Every table this takes a lock on is locked first, in the one order every old writer takes them in, so no old writer holds one while it waits on another this holds: an account's deletion begins at "user", a task's move at "task", a thread message at "inbox_message", a post or an answer at "inbox_item", and each reaches "inbox_attachment" and "attachment" after those. The tables the new foreign keys name are held against writes, and the two attachment tables against everything, for the copy alone: reading every inbox file's bytes took 0.3 s on production's 175 files (38 MB).
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.inbox_attachment')) = 'r' THEN
		LOCK TABLE "user", "task", "inbox_message", "inbox_item" IN SHARE ROW EXCLUSIVE MODE;
		LOCK TABLE "inbox_attachment", "attachment" IN ACCESS EXCLUSIVE MODE;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "task_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "inbox_item_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "inbox_message_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "kind" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "name" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "position" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_inbox_item" ON "attachment" ("inbox_item_id") WHERE "inbox_item_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_inbox_message" ON "attachment" ("inbox_message_id") WHERE "inbox_message_id" is not null;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_task_id_task_id_fkey";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_inbox_item_id_inbox_item_id_fkey";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_inbox_item_id_inbox_item_id_fkey" FOREIGN KEY ("inbox_item_id") REFERENCES "inbox_item"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_inbox_message_id_inbox_message_id_fkey";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_inbox_message_id_inbox_message_id_fkey" FOREIGN KEY ("inbox_message_id") REFERENCES "inbox_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_inbox_kind";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_inbox_kind" CHECK (("inbox_item_id" is null and "kind" is null) or ("inbox_item_id" is not null and (("kind" = 'image' and octet_length("bytes") <= 1500000 and "name" is null and "position" is null and "inbox_message_id" is null) or ("kind" = 'answer' and octet_length("bytes") <= 3000000 and "name" is not null and "position" is not null and "inbox_message_id" is null) or ("kind" = 'message' and octet_length("bytes") <= 3000000 and "name" is not null and "position" is not null and "inbox_message_id" is not null))));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_one_owner";--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_one_owner" CHECK (num_nonnulls("chat_message_id", "inbox_item_id") = 1 and ("inbox_message_id" is null or "inbox_item_id" is not null));--> statement-breakpoint
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.inbox_attachment')) = 'r' THEN
		INSERT INTO "attachment" ("id", "user_id", "task_id", "organization_id", "inbox_item_id", "inbox_message_id", "kind", "name", "position", "content_type", "byte_count", "bytes", "created_at")
			SELECT "id", "user_id", "task_id", "organization_id", "item_id", "message_id", "kind", "name", "position", "content_type", "byte_count", "bytes", "created_at" FROM "inbox_attachment"
			ON CONFLICT ("id") DO NOTHING;
		-- Renamed rather than dropped: a drop takes locks on every table its foreign keys name, past the order above, and a rename takes none. The table is dropped with the view, once no old writer stands.
		ALTER TABLE "inbox_attachment" RENAME TO "inbox_attachment_moved";
	END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE VIEW "inbox_attachment" AS
	SELECT "id", "user_id", "task_id", "organization_id", "inbox_item_id" AS "item_id", "inbox_message_id" AS "message_id", "kind", "name", "position", "content_type", "byte_count", "bytes", "created_at"
	FROM "attachment"
	WHERE "inbox_item_id" IS NOT NULL;--> statement-breakpoint
-- The defaults the table's columns had, which an insert through the view that leaves them out takes.
ALTER VIEW "inbox_attachment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER VIEW "inbox_attachment" ALTER COLUMN "kind" SET DEFAULT 'image';
