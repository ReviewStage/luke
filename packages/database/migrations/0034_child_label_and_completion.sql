ALTER TABLE "conversations" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "completion_delivered_at" timestamp with time zone;