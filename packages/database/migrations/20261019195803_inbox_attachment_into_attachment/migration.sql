-- contract: "inbox_attachment" stays readable and writable as a view over "attachment", its "item_id" and "message_id" aliasing "inbox_item_id" and "inbox_message_id", for runs still on a deployment from before this one; a later migration drops the view once they have drained.
-- Idempotent: the copy and the drop run only while "inbox_attachment" is still a table, so a preview database that ran this under an earlier draft folder name runs it again as a no-op.
-- Both tables are locked first, "inbox_attachment" before "attachment": the order a task's move to another workspace writes them in, so no old move waits on this while holding what this waits on. Reading every inbox file's bytes took 0.3 s on production's 175 files (38 MB), so the copy under the lock is short.
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.inbox_attachment')) = 'r' THEN
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
		DROP TABLE "inbox_attachment";
	END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE VIEW "inbox_attachment" AS
	SELECT "id", "user_id", "task_id", "organization_id", "inbox_item_id" AS "item_id", "inbox_message_id" AS "message_id", "kind", "name", "position", "content_type", "byte_count", "bytes", "created_at"
	FROM "attachment"
	WHERE "inbox_item_id" IS NOT NULL;--> statement-breakpoint
-- The defaults the table's columns had, which an insert through the view that leaves them out takes.
ALTER VIEW "inbox_attachment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER VIEW "inbox_attachment" ALTER COLUMN "kind" SET DEFAULT 'image';
