CREATE TABLE "account_plan_template_revision" (
	"user_id" text NOT NULL,
	"seq" integer NOT NULL,
	"actor" text NOT NULL,
	"document" text,
	"changes" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"restored_from" integer,
	CONSTRAINT "account_plan_template_revision_user_id_seq_pk" PRIMARY KEY("user_id","seq")
);
--> statement-breakpoint
ALTER TABLE "account_plan_template_revision" ADD CONSTRAINT "account_plan_template_revision_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;