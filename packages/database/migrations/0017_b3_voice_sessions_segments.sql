CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text,
	"live_session_id" text NOT NULL,
	"delegation_mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"usage" jsonb,
	CONSTRAINT "voice_sessions_live_session_id_unique" UNIQUE("live_session_id")
);
--> statement-breakpoint
CREATE TABLE "voice_transcript_segments" (
	"voice_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	CONSTRAINT "voice_transcript_segments_voice_session_id_seq_pk" PRIMARY KEY("voice_session_id","seq")
);
--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_transcript_segments" ADD CONSTRAINT "voice_transcript_segments_voice_session_id_voice_sessions_id_fk" FOREIGN KEY ("voice_session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_sessions_by_owner" ON "voice_sessions" USING btree ("user_id","live_session_id");