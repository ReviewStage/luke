-- contract: "chat_attachment" stays readable and writable as a view over "attachment", its "message_id" aliasing "chat_message_id", for runs still on a deployment from before this one; a later migration drops the view once they have drained.
-- Idempotent: the copy and the drop run only while "chat_attachment" is still a table, so a preview database that ran this under an earlier draft folder name runs it again as a no-op.
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.chat_attachment')) = 'r' THEN
		-- Taken before any write here, so no old write lands in the table between the copy and the drop, and the migration holds nothing an old writer waits on while it waits for the lock.
		LOCK TABLE "chat_attachment" IN ACCESS EXCLUSIVE MODE;
		-- A picture "attachment" lacks: one kept before it was written to beside "chat_attachment", a set that no longer grows, so the copy under the lock reads only those pictures' bytes.
		INSERT INTO "attachment" ("id", "organization_id", "chat_message_id", "content_type", "byte_count", "bytes", "created_at")
			SELECT "id", "organization_id", "message_id", "content_type", "byte_count", "bytes", "created_at" FROM "chat_attachment" AS "old"
			WHERE NOT EXISTS (SELECT 1 FROM "attachment" WHERE "attachment"."id" = "old"."id")
			ON CONFLICT ("id") DO NOTHING;
		-- A picture moved to another workspace by code that moved "chat_attachment" alone.
		UPDATE "attachment" SET "organization_id" = "old"."organization_id"
			FROM "chat_attachment" AS "old"
			WHERE "attachment"."id" = "old"."id" AND "attachment"."organization_id" <> "old"."organization_id";
		-- A picture its message dropped by code that dropped it from "chat_attachment" alone: the table holds every chat picture, since every write of one writes it there first.
		DELETE FROM "attachment"
			WHERE "chat_message_id" IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM "chat_attachment" AS "old" WHERE "old"."id" = "attachment"."id");
		DROP TABLE "chat_attachment";
	END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE VIEW "chat_attachment" AS
	SELECT "id", "organization_id", "chat_message_id" AS "message_id", "content_type", "byte_count", "bytes", "created_at"
	FROM "attachment"
	WHERE "chat_message_id" IS NOT NULL;
