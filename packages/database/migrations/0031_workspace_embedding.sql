CREATE TABLE "workspace_embedding" (
	"user_id" text NOT NULL,
	"hash" text NOT NULL,
	"model" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "workspace_embedding_user_id_hash_pk" PRIMARY KEY("user_id","hash")
);
--> statement-breakpoint
ALTER TABLE "workspace_embedding" ADD CONSTRAINT "workspace_embedding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
