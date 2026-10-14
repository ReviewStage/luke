CREATE TABLE "github_installation" (
	"organization_id" text PRIMARY KEY,
	"installation_id" bigint NOT NULL UNIQUE,
	"account_id" bigint NOT NULL UNIQUE,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;