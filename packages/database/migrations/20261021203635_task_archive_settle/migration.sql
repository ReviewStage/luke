-- Custom SQL migration file, put your code below! --
-- A task is no longer archived: it only stands in a status. Every task still
-- stamped archived settles into one, Done where a coding agent on it has a
-- merged pull request and Canceled where none does, keeping a Done or
-- Canceled it already stood in; it counts as finished when it was archived,
-- unless it was stamped finished before, so a task put away long ago does
-- not flood the Board's past week. Its coding agents stay archived as they
-- are. Every statement names the stamp, which the last one clears, so a
-- second run changes nothing.
UPDATE "task" SET "status" = CASE
	WHEN EXISTS (
		SELECT 1 FROM "coding_agent"
		WHERE "coding_agent"."task_id" = "task"."id" AND "coding_agent"."published" ->> 'mergedAt' IS NOT NULL
	) THEN 'done'
	ELSE 'canceled'
END
WHERE "archived_at" IS NOT NULL AND "status" NOT IN ('done', 'canceled');
--> statement-breakpoint
UPDATE "task" SET "completed_at" = coalesce("completed_at", "archived_at") WHERE "archived_at" IS NOT NULL;
--> statement-breakpoint
-- The task's own chat channel, archived with it, opens again.
UPDATE "chat_channel" SET "archived_at" = NULL
WHERE "kind" = 'plan' AND "archived_at" IS NOT NULL
	AND "task_id" IN (SELECT "id" FROM "task" WHERE "archived_at" IS NOT NULL);
--> statement-breakpoint
-- The task's inbox items were hidden with it and would come back as new and
-- waiting. Each open ask on their threads is withdrawn, as an agent's close
-- withdraws one, with why.
UPDATE "inbox_message" SET "ask" = "ask" || jsonb_build_object('status', 'withdrawn', 'withdrawnReason', 'The task was archived before this was answered.')
WHERE "ask" ->> 'status' = 'open' AND "item_id" IN (
	SELECT "inbox_item"."id" FROM "inbox_item"
	JOIN "task" ON "task"."id" = "inbox_item"."task_id"
	WHERE "task"."archived_at" IS NOT NULL AND "inbox_item"."status" = 'open'
);
--> statement-breakpoint
-- An item that asked something is closed as its agent closes one, with the same reason and its revision moved on.
UPDATE "inbox_item" SET
	"status" = 'closed',
	"closed_reason" = 'The task was archived before this was answered.',
	"closed_by" = NULL,
	"revision" = "revision" + 1,
	"settled_at" = now(),
	"updated_at" = now(),
	"open_ask_message_id" = NULL
WHERE "status" = 'open' AND "response" ->> 'type' <> 'none'
	AND "task_id" IN (SELECT "id" FROM "task" WHERE "archived_at" IS NOT NULL);
--> statement-breakpoint
-- A notice, which waited on a nod alone, is acknowledged as Got it acknowledges one, by nobody the service names.
UPDATE "inbox_item" SET
	"status" = 'answered',
	"answer" = '{"reply":"acknowledged"}'::jsonb,
	"answer_key" = NULL,
	"answered_by" = NULL,
	"settled_at" = now(),
	"updated_at" = now(),
	"open_ask_message_id" = NULL
WHERE "status" = 'open' AND "response" ->> 'type' = 'none'
	AND "task_id" IN (SELECT "id" FROM "task" WHERE "archived_at" IS NOT NULL);
--> statement-breakpoint
-- Every item of the task reads as read through its last change for every member, the ones just settled included, and no member's unread mark on one stands.
UPDATE "inbox_item" SET "read_through" = greatest("read_through", "updated_at")
WHERE "task_id" IN (SELECT "id" FROM "task" WHERE "archived_at" IS NOT NULL);
--> statement-breakpoint
UPDATE "inbox_item_read" SET "marked_unread" = false
WHERE "marked_unread" AND "item_id" IN (
	SELECT "inbox_item"."id" FROM "inbox_item"
	JOIN "task" ON "task"."id" = "inbox_item"."task_id"
	WHERE "task"."archived_at" IS NOT NULL
);
--> statement-breakpoint
-- A task an older build settled without stamping when counts as finished now.
UPDATE "task" SET "completed_at" = now() WHERE "status" IN ('done', 'canceled') AND "completed_at" IS NULL;
--> statement-breakpoint
UPDATE "task" SET "archived_at" = NULL WHERE "archived_at" IS NOT NULL;
