-- Custom SQL migration file, put your code below! --
-- No agent runs on eve any more, and one on it takes no message, so every
-- agent whose conversation runs on eve, or names no runtime, as one from
-- before the column, is archived where it stands unarchived: by the app for
-- its starter, with why, as an archive the app makes is stamped. Its
-- conversation and transcript are left as they are, and a member who
-- brings it back finds it refused as ended and continues it in a new agent.
-- As every archive does, its open Inbox items that ask or wait on a reply
-- are closed with why and their asks withdrawn, under the archive's own
-- stamp, which an unarchive reads to open them again. `now()` is the
-- transaction's one instant, so every statement names the agents this
-- migration archived, and a second run archives and settles nothing.
UPDATE "agent" SET
	"archived_at" = now(),
	"archived_by" = jsonb_build_object(
		'by', 'luke',
		'userId', "agent"."user_id",
		'reason', 'Its runtime was retired. Continue it in a new agent to go on from its work.'
	)
FROM "conversations"
WHERE "conversations"."id" = "agent"."conversation_id"
	AND ("conversations"."runtime" IS NULL OR "conversations"."runtime" = 'eve')
	AND "agent"."archived_at" IS NULL;
--> statement-breakpoint
UPDATE "inbox_message" SET "ask" = "ask" || jsonb_build_object('status', 'withdrawn', 'withdrawnReason', 'Its agent was archived.')
WHERE "ask" ->> 'status' = 'open' AND "item_id" IN (
	SELECT "inbox_item"."id" FROM "inbox_item"
	JOIN "agent" ON "agent"."id" = "inbox_item"."agent_id"
	WHERE "agent"."archived_at" = now()
		AND "inbox_item"."status" = 'open'
		AND ("inbox_item"."open_ask_message_id" IS NOT NULL OR "inbox_item"."needs_reply")
);
--> statement-breakpoint
UPDATE "inbox_item" SET
	"status" = 'closed',
	"closed_reason" = 'Its agent was archived.',
	"closed_by" = NULL,
	"settled_at" = now(),
	"open_ask_message_id" = NULL
FROM "agent"
WHERE "agent"."id" = "inbox_item"."agent_id"
	AND "agent"."archived_at" = now()
	AND "inbox_item"."status" = 'open'
	AND ("inbox_item"."open_ask_message_id" IS NOT NULL OR "inbox_item"."needs_reply");
