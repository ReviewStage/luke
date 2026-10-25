-- Chat's pictures go with it: no owner is left to hold them once the column is dropped.
DELETE FROM "attachment" WHERE "chat_message_id" IS NOT NULL;--> statement-breakpoint
-- A line Chat or another agent steered into an agent's transcript reads on as an agent message, by whoever its notice named, so the transcript still decodes.
UPDATE "messages" SET "metadata" = jsonb_build_object('author', 'agent', 'channel', 'agent_message', 'from', "metadata"->'from') WHERE "metadata"->>'channel' = 'chat';--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_chat_message_id_chat_message_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_channel" DROP CONSTRAINT "chat_channel_dm_a_member_id_chat_member_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_channel" DROP CONSTRAINT "chat_channel_dm_b_member_id_chat_member_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_channel" DROP CONSTRAINT "chat_channel_created_by_member_id_chat_member_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_member" DROP CONSTRAINT "chat_member_notice_channel_id_chat_channel_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_message" DROP CONSTRAINT "chat_message_channel_id_chat_channel_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_message" DROP CONSTRAINT "chat_message_author_member_id_chat_member_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_message" DROP CONSTRAINT "chat_message_answered_by_member_id_chat_member_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_read" DROP CONSTRAINT "chat_read_member_id_chat_member_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_read" DROP CONSTRAINT "chat_read_channel_id_chat_channel_id_fkey";--> statement-breakpoint
DROP TABLE "chat_channel";--> statement-breakpoint
DROP TABLE "chat_member";--> statement-breakpoint
DROP TABLE "chat_message";--> statement-breakpoint
DROP TABLE "chat_read";--> statement-breakpoint
DROP TABLE "workspace_chat";--> statement-breakpoint
DROP INDEX "attachment_chat_message";--> statement-breakpoint
ALTER TABLE "attachment" DROP COLUMN "chat_message_id";--> statement-breakpoint
DROP INDEX "attachment_unsaved";--> statement-breakpoint
CREATE INDEX "attachment_unsaved" ON "attachment" ("created_at") WHERE ("task_id" is not null and num_nonnulls("inbox_item_id", "conversation_id", "plan_comment_id") = 0) and "saved_at" is null;--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_one_owner", ADD CONSTRAINT "attachment_one_owner" CHECK ((num_nonnulls("inbox_item_id", "conversation_id", "plan_comment_id") = 1 or ("task_id" is not null and num_nonnulls("inbox_item_id", "conversation_id", "plan_comment_id") = 0)) and ("inbox_message_id" is null or "inbox_item_id" is not null));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_bytes_bound", ADD CONSTRAINT "attachment_bytes_bound" CHECK (("conversation_id" is null or octet_length("bytes") <= 4000000) and (not ("task_id" is not null and num_nonnulls("inbox_item_id", "conversation_id", "plan_comment_id") = 0) or octet_length("bytes") <= 1500000 or ("content_type" = 'video/webm' and octet_length("bytes") <= 4000000)));