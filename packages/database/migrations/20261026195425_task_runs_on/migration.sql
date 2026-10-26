ALTER TABLE "task" ADD COLUMN "machine" text DEFAULT 'vercel' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;