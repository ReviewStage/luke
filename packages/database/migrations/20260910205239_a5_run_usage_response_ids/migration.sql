ALTER TABLE "conversation_run" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_run" ADD COLUMN "response_ids" text[];