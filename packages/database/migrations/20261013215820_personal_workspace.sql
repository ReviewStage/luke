CREATE TABLE "personal_workspace" (
	"user_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_workspace_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "personal_workspace" ADD CONSTRAINT "personal_workspace_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_workspace" ADD CONSTRAINT "personal_workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;