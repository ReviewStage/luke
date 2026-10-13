CREATE TABLE "observation_pass" (
	"user_id" text PRIMARY KEY NOT NULL,
	"attempted_at" bigint NOT NULL,
	"observed_at" bigint,
	"failure" text
);
--> statement-breakpoint
CREATE TABLE "roster_diff" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"observed_at" bigint NOT NULL,
	"previous_observed_at" bigint NOT NULL,
	"sealed_payload" text NOT NULL,
	"consumed_at" bigint,
	CONSTRAINT "roster_diff_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "observation_pass" ADD CONSTRAINT "observation_pass_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_diff" ADD CONSTRAINT "roster_diff_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_diff_by_user_pending" ON "roster_diff" USING btree ("user_id","consumed_at","observed_at");