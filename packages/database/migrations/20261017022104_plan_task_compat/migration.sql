-- The plan's old names, kept readable beside the task's for the deployments
-- still running code from before 20261017014941_rename_plan_to_task. Note that
-- the build migrates before the new deployment serves, and an eve session's
-- owner run stays on the deployment it started on until a handoff, so those
-- deployments query "plan" and "plan_id" after the rename. A view over each
-- renamed table answers reads and writes under the old names; a virtual
-- generated column answers reads of each renamed column, and writes nothing,
-- stores nothing, and rewrites no row. A later migration drops all of it once
-- no deployment from before the rename owns a session.
CREATE VIEW "plan" AS SELECT * FROM "task";--> statement-breakpoint
CREATE VIEW "plan_board" AS SELECT "task_id" AS "plan_id", "elements", "applied_drawing", "drawing", "drawing_number", "updated_at", "image" FROM "task_board";--> statement-breakpoint
CREATE VIEW "plan_pin" AS SELECT "user_id", "task_id" AS "plan_id", "pinned_at", "position" FROM "task_pin";--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "chat_channel" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "chat_member" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN "task" text GENERATED ALWAYS AS ("prompt") VIRTUAL;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "inbox_attachment" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "plan_attachment" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "plan_comment" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "plan_comment_thread" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "plan_page_version" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "plan_revision" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "plan_id" uuid GENERATED ALWAYS AS ("task_id") VIRTUAL;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "task_revision" integer GENERATED ALWAYS AS ("ask_revision") VIRTUAL;
