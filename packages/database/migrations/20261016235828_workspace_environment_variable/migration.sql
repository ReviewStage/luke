CREATE TABLE "workspace_environment_variable" (
	"organization_id" text,
	"name" text,
	"kind" text NOT NULL,
	"key_version" integer NOT NULL,
	"sealed_data_key" text NOT NULL,
	"sealed_value" text NOT NULL,
	"hint" text NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_environment_variable_pkey" PRIMARY KEY("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "workspace_environment_variable" ADD CONSTRAINT "workspace_environment_variable_ueCmXMp5f6h8_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_environment_variable" ADD CONSTRAINT "workspace_environment_variable_updated_by_user_id_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;