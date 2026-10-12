CREATE TABLE "repository_pin" (
	"user_id" text NOT NULL,
	"repository" text NOT NULL,
	"pinned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repository_pin_user_id_repository_pk" PRIMARY KEY("user_id","repository")
);
--> statement-breakpoint
ALTER TABLE "repository_pin" ADD CONSTRAINT "repository_pin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
