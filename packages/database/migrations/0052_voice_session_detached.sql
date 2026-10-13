ALTER TABLE "voice_sessions" ADD COLUMN "detached_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "voice_sessions_detached" ON "voice_sessions" USING btree ("detached_at") WHERE "closed_at" IS NULL AND "detached_at" IS NOT NULL;
