CREATE TABLE "admin_favorite" (
	"admin_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "admin_favorite_admin_id_user_id_pk" PRIMARY KEY("admin_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "admin_favorite" ADD CONSTRAINT "admin_favorite_admin_id_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_favorite" ADD CONSTRAINT "admin_favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;