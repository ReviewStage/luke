CREATE TABLE "workspace_former_slug" (
	"slug" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workspace_former_slug_organization_idx" ON "workspace_former_slug" ("organization_id");--> statement-breakpoint
ALTER TABLE "workspace_former_slug" ADD CONSTRAINT "workspace_former_slug_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;