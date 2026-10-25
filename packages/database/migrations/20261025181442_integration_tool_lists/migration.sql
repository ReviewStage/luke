ALTER TABLE "integration_connection" ADD COLUMN "tools" jsonb;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD COLUMN "tools_listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_integration_connection" ADD COLUMN "tools" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_integration_connection" ADD COLUMN "tools_listed_at" timestamp with time zone;