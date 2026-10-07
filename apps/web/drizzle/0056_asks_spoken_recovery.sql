ALTER TABLE "asks" ADD COLUMN "voice_session_id" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "task_revision" integer;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "told_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "end_told_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "asks_by_voice_session" ON "asks" USING btree ("user_id","voice_session_id") WHERE "voice_session_id" IS NOT NULL;
