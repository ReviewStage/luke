-- contract: the per-task Luke's data, dropped now that nothing reads it (#4335 deleted the per-task Luke). One migration, idempotent: every statement is a no-op run a second time.
-- 1. "task"."conversation_id" goes first. Its drop holds "task" until this commits, so a deployment from before #4335 cannot open a task's conversation behind the stamp below: one that opened it before the drop committed it first, and the stamp's statement, run after, reads it; one that tries after fails on the missing column and writes nothing.
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "plan_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "conversation_id";--> statement-breakpoint
-- 2. Every conversation of the per-task Luke's ("plan", the retired `CONVERSATION_KIND.TASK`), and every child under one, stamped deleted as a task's delete stamps its agents' (`task-store.ts`), so the sweep purges them thirty days on and queues their sessions' sandboxes (`soft-delete.ts`). A row already stamped keeps its stamp.
WITH RECURSIVE "luke_conversation" AS (
	SELECT "id" FROM "conversations" WHERE "kind" = 'plan'
	UNION
	SELECT "conversations"."id" FROM "conversations"
		INNER JOIN "luke_conversation" ON "conversations"."parent_conversation_id" = "luke_conversation"."id"
)
UPDATE "conversations" SET "deleted_at" = now()
	WHERE "id" IN (SELECT "id" FROM "luke_conversation") AND "deleted_at" IS NULL;--> statement-breakpoint
-- 3. The words said on every call with no agent, once it has ended as the sweep reads an end: closed, or started longer ago than a Live session runs (`VOICE_SESSION_LIMIT_MS`, an hour). Nothing reads them back since #4335. The calls themselves and their avatar sessions stay: the admin's activity and cost pages read them.
DELETE FROM "voice_transcript_segments" WHERE "voice_session_id" IN (
	SELECT "id" FROM "voice_sessions"
		WHERE "agent_id" IS NULL AND ("closed_at" IS NOT NULL OR "started_at" <= now() - interval '1 hour')
);--> statement-breakpoint
-- 4. The per-task Luke's chat members ("planner"), each only where it wrote no message and is one of no DM, since a member's deletion cascades into both.
DELETE FROM "chat_member" WHERE "kind" = 'planner'
	AND NOT EXISTS (SELECT 1 FROM "chat_message" WHERE "chat_message"."author_member_id" = "chat_member"."id")
	AND NOT EXISTS (
		SELECT 1 FROM "chat_channel"
			WHERE "chat_channel"."dm_a_member_id" = "chat_member"."id" OR "chat_channel"."dm_b_member_id" = "chat_member"."id"
	);--> statement-breakpoint
-- A planner the guard kept fails the whole migration, before anything of the kind is dropped: no code decodes the kind any more.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "chat_member" WHERE "kind" = 'planner') THEN
		RAISE EXCEPTION 'chat_member: % planner member(s) wrote a message or are in a DM, so none of the per-task Luke''s data was dropped',
			(SELECT count(*) FROM "chat_member" WHERE "kind" = 'planner');
	END IF;
END $$;--> statement-breakpoint
-- 5. What only a planner used: its task, the index on it, and the kind's terms in the constraint and the retired handle's index.
DROP INDEX IF EXISTS "chat_member_task";--> statement-breakpoint
ALTER TABLE "chat_member" DROP CONSTRAINT IF EXISTS "chat_member_plan_id_plan_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_member" DROP CONSTRAINT IF EXISTS "chat_member_id_of_kind";--> statement-breakpoint
ALTER TABLE "chat_member" DROP COLUMN IF EXISTS "task_id";--> statement-breakpoint
ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_id_of_kind" CHECK (("kind" = 'human') = ("user_id" is not null)
        and ("agent_id" is null or "kind" = 'agent'));--> statement-breakpoint
DROP INDEX IF EXISTS "chat_member_organization_handle";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_member_organization_handle" ON "chat_member" ("organization_id","handle");
