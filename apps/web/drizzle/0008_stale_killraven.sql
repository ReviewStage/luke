CREATE TABLE "watch_memory" (
	"user_id" text PRIMARY KEY NOT NULL,
	"memory" jsonb NOT NULL,
	"passed_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_memory" ADD CONSTRAINT "watch_memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;