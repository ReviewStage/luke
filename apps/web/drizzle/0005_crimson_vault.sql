CREATE TABLE "provider_key" (
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"hint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_key_user_id_provider_id_pk" PRIMARY KEY("user_id","provider_id")
);
--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
