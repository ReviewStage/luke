CREATE TABLE "hosted_usage" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"voice_calls" integer DEFAULT 0 NOT NULL,
	"attention_reviews" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hosted_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "hosted_usage" ADD CONSTRAINT "hosted_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;