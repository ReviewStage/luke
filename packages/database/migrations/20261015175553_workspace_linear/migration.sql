CREATE TABLE "workspace_integration_connection" (
	"organization_id" text,
	"provider" text,
	"status" text NOT NULL,
	"state" text,
	"state_issued_at" timestamp with time zone,
	"connect_verifier" text,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_integration_connection_pkey" PRIMARY KEY("organization_id","provider")
);
--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "linear_issue" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_integration_connection_state_idx" ON "workspace_integration_connection" ("state");--> statement-breakpoint
ALTER TABLE "workspace_integration_connection" ADD CONSTRAINT "workspace_integration_connection_HMbDsJWkK6TV_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_integration_connection" ADD CONSTRAINT "workspace_integration_connection_3ggWlPzIKenx_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;