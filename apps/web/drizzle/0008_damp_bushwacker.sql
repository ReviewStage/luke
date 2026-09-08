CREATE TABLE "account_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"voice" text,
	"voice_speed" double precision,
	"default_workspace_provider" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_workspace_preference" (
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"default_project_id" text,
	"agent" text,
	"model" text,
	"effort" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_workspace_preference_user_id_provider_id_pk" PRIMARY KEY("user_id","provider_id")
);
--> statement-breakpoint
ALTER TABLE "account_preference" ADD CONSTRAINT "account_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_workspace_preference" ADD CONSTRAINT "account_workspace_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;