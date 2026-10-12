CREATE TABLE "voice_session_usage" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"seconds" double precision NOT NULL,
	"recorded_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_usage" ADD COLUMN "voice_seconds" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_session_usage" ADD CONSTRAINT "voice_session_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;