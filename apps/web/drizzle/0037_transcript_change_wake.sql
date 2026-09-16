CREATE TABLE "transcript_mark" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mark" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_mark" ADD CONSTRAINT "transcript_mark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "turns" SET "origin" = 'transcript_change' WHERE "origin" = 'roster_diff';--> statement-breakpoint
UPDATE "messages" SET "metadata" = jsonb_set("metadata", '{source}', '"transcript_change"') WHERE "metadata"->>'source' = 'roster_look';--> statement-breakpoint
DROP TABLE "roster_consumed";--> statement-breakpoint
DROP TABLE "roster_diff";
