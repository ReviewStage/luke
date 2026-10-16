CREATE TABLE "issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"creator_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "issue_org_number" ON "issue" ("organization_id","number");--> statement-breakpoint
CREATE INDEX "issue_org_updated" ON "issue" ("organization_id","updated_at");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_id_user_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "user"("id") ON DELETE SET NULL;