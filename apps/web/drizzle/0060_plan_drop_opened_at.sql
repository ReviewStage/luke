DROP INDEX IF EXISTS "plan_user_opened";--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN IF EXISTS "opened_at";
