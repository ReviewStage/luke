CREATE TABLE "conversation_lease" (
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"owner_id" text NOT NULL,
	"acquired_at" bigint NOT NULL,
	"heartbeat_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "conversation_lease_user_id_session_key_pk" PRIMARY KEY("user_id","session_key")
);
--> statement-breakpoint
CREATE TABLE "conversation_line_rating" (
	"user_id" text NOT NULL,
	"session_key" text NOT NULL,
	"event_key" text NOT NULL,
	"rating" text NOT NULL,
	"sealed_note" text,
	"device_id" text NOT NULL,
	"rated_at" bigint NOT NULL,
	CONSTRAINT "conversation_line_rating_user_id_session_key_event_key_pk" PRIMARY KEY("user_id","session_key","event_key")
);
--> statement-breakpoint
ALTER TABLE "conversation_run" ADD COLUMN "cancel_requested_at" bigint;--> statement-breakpoint
ALTER TABLE "conversation_lease" ADD CONSTRAINT "conversation_lease_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_line_rating" ADD CONSTRAINT "conversation_line_rating_conversation_fk" FOREIGN KEY ("user_id","session_key") REFERENCES "public"."conversation"("user_id","session_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_line_rating" ADD CONSTRAINT "conversation_line_rating_line_fk" FOREIGN KEY ("user_id","session_key","event_key") REFERENCES "public"."conversation_line"("user_id","session_key","event_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_line_rating_by_rating" ON "conversation_line_rating" USING btree ("user_id","rating","rated_at");