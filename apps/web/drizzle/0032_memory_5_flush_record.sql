ALTER TABLE "conversations" ADD COLUMN "memory_flush_operation_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "memory_flush_outcome" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "memory_flushed_at" timestamp with time zone;
