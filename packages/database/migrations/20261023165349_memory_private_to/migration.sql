ALTER TABLE "memory" ADD COLUMN IF NOT EXISTS "private_to" text;--> statement-breakpoint
ALTER TABLE "memory" DROP CONSTRAINT IF EXISTS "memory_private_to_user_id_fkey";--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_private_to_user_id_fkey" FOREIGN KEY ("private_to") REFERENCES "user"("id") ON DELETE CASCADE;
