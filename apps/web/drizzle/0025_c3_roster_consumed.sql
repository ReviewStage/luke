CREATE TABLE "roster_consumed" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sealed_body" text NOT NULL,
	"observed_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster_consumed" ADD CONSTRAINT "roster_consumed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;