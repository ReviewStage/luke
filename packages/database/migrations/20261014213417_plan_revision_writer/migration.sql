ALTER TABLE "plan_revision" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "plan_revision" DROP CONSTRAINT IF EXISTS "plan_revision_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "plan_revision" ADD CONSTRAINT "plan_revision_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;
