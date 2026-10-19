-- contract: "chat_attachment" stays readable and writable as a view over "attachment", its "message_id" aliasing "chat_message_id", for runs still on a deployment from before this one; a later migration drops the view once they have drained.
-- Idempotent: the copy and the drop run only while "chat_attachment" is still a table, so a preview database that ran this under an earlier draft folder name runs it again as a no-op.
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.chat_attachment')) = 'r' THEN
		-- Held from before the copy to the drop, so no write lands in the table between them.
		LOCK TABLE "chat_attachment" IN ACCESS EXCLUSIVE MODE;
		INSERT INTO "attachment" ("id", "organization_id", "chat_message_id", "content_type", "byte_count", "bytes", "created_at")
			SELECT "id", "organization_id", "message_id", "content_type", "byte_count", "bytes", "created_at" FROM "chat_attachment"
			ON CONFLICT ("id") DO NOTHING;
		DROP TABLE "chat_attachment";
	END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE VIEW "chat_attachment" AS
	SELECT "id", "organization_id", "chat_message_id" AS "message_id", "content_type", "byte_count", "bytes", "created_at"
	FROM "attachment"
	WHERE "chat_message_id" IS NOT NULL;
