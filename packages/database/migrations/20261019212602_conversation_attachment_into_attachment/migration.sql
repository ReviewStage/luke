-- contract: "conversation_attachment" stays readable and writable as a view over "attachment", for runs still on a deployment from before this one; the table itself stands renamed "conversation_attachment_moved", and a later migration drops it and the view once they have drained.
-- Idempotent: the copy and the rename run only while "conversation_attachment" is still a table, so a preview database that ran this under an earlier draft folder name runs it again as a no-op.
-- Only the two tables this changes are locked, the old one first: an old picture's keeping reads it before it reaches "conversations", a conversation's deletion cascades into it before "attachment", and an agent's turn holds its conversation's row while it writes "conversations" alone, so none holds what this waits on while it waits on what this holds, and the copy's check of each picture's conversation waits only for a turn to end. The foreign key the copy checks stands since the migration before this one, a deployment ahead, because adding it locks "conversations". The one cycle left is an account deleted in the same moment whose own pictures are among these, which aborts one of the two to be run again. Reading every picture's bytes took 1.1 s on production's 303 pictures (46 MB). The old table is renamed rather than dropped, which locks no table its keys name.
DO $$ BEGIN
	IF (SELECT "relkind" FROM "pg_class" WHERE "oid" = to_regclass('public.conversation_attachment')) = 'r' THEN
		LOCK TABLE "conversation_attachment", "attachment" IN ACCESS EXCLUSIVE MODE;
		-- Each picture under its id and hash, and no workspace: a conversation's picture has none.
		INSERT INTO "attachment" ("id", "user_id", "conversation_id", "sha256", "content_type", "width", "height", "byte_count", "bytes", "created_at")
			SELECT "id", "user_id", "conversation_id", "sha256", "content_type", "width", "height", "byte_count", "bytes", "created_at" FROM "conversation_attachment"
			ON CONFLICT ("id") DO NOTHING;
		-- Renamed rather than dropped: a drop takes locks on every table its foreign keys name, and a rename takes none. The table is dropped with the view, once no old writer stands.
		ALTER TABLE "conversation_attachment" RENAME TO "conversation_attachment_moved";
	END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE VIEW "conversation_attachment" AS
	SELECT "id", "user_id", "conversation_id", "sha256", "content_type", "width", "height", "byte_count", "bytes", "created_at"
	FROM "attachment"
	WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint
-- The default the table's id had, which an insert through the view that leaves it out takes.
ALTER VIEW "conversation_attachment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
