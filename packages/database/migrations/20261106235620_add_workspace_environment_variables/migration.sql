CREATE TABLE "workspace_environment_variable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"key_version" integer NOT NULL,
	"sealed_data_key" text NOT NULL,
	"sealed_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_environment_variable_name" ON "workspace_environment_variable" ("organization_id","name");--> statement-breakpoint
ALTER TABLE "workspace_environment_variable" ADD CONSTRAINT "workspace_environment_variable_ueCmXMp5f6h8_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;