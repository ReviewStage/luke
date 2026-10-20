ALTER TABLE "conversations" ADD COLUMN "native_sequence" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "native_projection" jsonb;