CREATE TABLE "account_provider_key" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"key_version" integer NOT NULL,
	"sealed_data_key" text NOT NULL,
	"sealed_key" text NOT NULL,
	"hint" text NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_provider_key_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD CONSTRAINT "account_provider_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
