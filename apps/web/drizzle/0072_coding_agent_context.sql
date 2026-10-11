ALTER TABLE "coding_agent" ADD COLUMN "last_step" jsonb;--> statement-breakpoint
ALTER TABLE "coding_agent" ADD COLUMN "compacted_at" timestamp with time zone;
