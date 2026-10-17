ALTER TABLE "plan" RENAME TO "task";--> statement-breakpoint
ALTER TABLE "plan_board" RENAME TO "task_board";--> statement-breakpoint
ALTER TABLE "plan_pin" RENAME TO "task_pin";--> statement-breakpoint
ALTER TABLE "automation" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "chat_channel" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "chat_member" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "coding_agent" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "coding_agent" RENAME COLUMN "task" TO "prompt";--> statement-breakpoint
ALTER TABLE "inbox_item" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "inbox_attachment" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "plan_attachment" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "plan_comment" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "plan_comment_thread" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "plan_page_version" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "plan_revision" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "asks" RENAME COLUMN "task_revision" TO "ask_revision";--> statement-breakpoint
ALTER TABLE "task_board" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "task_pin" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "voice_sessions" RENAME COLUMN "plan_id" TO "task_id";--> statement-breakpoint
ALTER INDEX "automation_trigger_plan" RENAME TO "automation_trigger_task";--> statement-breakpoint
ALTER INDEX "chat_channel_plan" RENAME TO "chat_channel_task";--> statement-breakpoint
ALTER INDEX "chat_member_plan" RENAME TO "chat_member_task";--> statement-breakpoint
ALTER INDEX "coding_agent_plan_created" RENAME TO "coding_agent_task_created";--> statement-breakpoint
ALTER INDEX "inbox_item_plan_updated" RENAME TO "inbox_item_task_updated";--> statement-breakpoint
ALTER INDEX "plan_attachment_plan" RENAME TO "plan_attachment_task";--> statement-breakpoint
ALTER INDEX "plan_comment_plan" RENAME TO "plan_comment_task";--> statement-breakpoint
ALTER INDEX "plan_comment_thread_plan_created" RENAME TO "plan_comment_thread_task_created";--> statement-breakpoint
ALTER INDEX "plan_page_version_plan" RENAME TO "plan_page_version_task";--> statement-breakpoint
ALTER INDEX "plan_user_created" RENAME TO "task_user_created";--> statement-breakpoint
ALTER INDEX "plan_organization_created" RENAME TO "task_organization_created";--> statement-breakpoint
ALTER INDEX "plan_pin_plan" RENAME TO "task_pin_task";
