CREATE TABLE IF NOT EXISTS "voice_avatar_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voice_session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"liveavatar_session_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"seconds" integer,
	"end_reason" text,
	CONSTRAINT "voice_avatar_sessions_liveavatar_session_id_unique" UNIQUE("liveavatar_session_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_avatar_sessions" ADD CONSTRAINT "voice_avatar_sessions_voice_session_id_voice_sessions_id_fk" FOREIGN KEY ("voice_session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "voice_avatar_sessions" ADD CONSTRAINT "voice_avatar_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_avatar_sessions_open" ON "voice_avatar_sessions" USING btree ("voice_session_id") WHERE "voice_avatar_sessions"."ended_at" is null;
