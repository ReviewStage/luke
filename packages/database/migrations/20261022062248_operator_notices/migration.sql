CREATE TABLE IF NOT EXISTS "operator_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"operator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator_wake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"operator_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"woken_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operator_notice_unread" ON "operator_notice" ("operator_id","agent_id","kind") WHERE "read_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_notice_operator_at" ON "operator_notice" ("operator_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_notice_agent" ON "operator_notice" ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operator_wake_operator_agent" ON "operator_wake" ("operator_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_wake_agent" ON "operator_wake" ("agent_id");--> statement-breakpoint
ALTER TABLE "operator_notice" DROP CONSTRAINT IF EXISTS "operator_notice_operator_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "operator_notice" ADD CONSTRAINT "operator_notice_operator_id_coding_agent_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operator_notice" DROP CONSTRAINT IF EXISTS "operator_notice_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "operator_notice" ADD CONSTRAINT "operator_notice_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operator_notice" DROP CONSTRAINT IF EXISTS "operator_notice_task_id_task_id_fkey";--> statement-breakpoint
ALTER TABLE "operator_notice" ADD CONSTRAINT "operator_notice_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "operator_wake" DROP CONSTRAINT IF EXISTS "operator_wake_operator_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "operator_wake" ADD CONSTRAINT "operator_wake_operator_id_coding_agent_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operator_wake" DROP CONSTRAINT IF EXISTS "operator_wake_agent_id_coding_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "operator_wake" ADD CONSTRAINT "operator_wake_agent_id_coding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "coding_agent"("id") ON DELETE CASCADE;