CREATE TABLE IF NOT EXISTS "voice_avatar_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"voice_session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"seconds" integer,
	"end_reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_avatar_sessions_open" ON "voice_avatar_sessions" ("voice_session_id") WHERE "ended_at" is null;--> statement-breakpoint
ALTER TABLE "voice_avatar_sessions" DROP CONSTRAINT IF EXISTS "voice_avatar_sessions_voice_session_id_voice_sessions_id_fkey";--> statement-breakpoint
ALTER TABLE "voice_avatar_sessions" ADD CONSTRAINT "voice_avatar_sessions_voice_session_id_voice_sessions_id_fkey" FOREIGN KEY ("voice_session_id") REFERENCES "voice_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "voice_avatar_sessions" DROP CONSTRAINT IF EXISTS "voice_avatar_sessions_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "voice_avatar_sessions" ADD CONSTRAINT "voice_avatar_sessions_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
