ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "machine" text DEFAULT 'vercel' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "device_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task" ADD CONSTRAINT "task_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
