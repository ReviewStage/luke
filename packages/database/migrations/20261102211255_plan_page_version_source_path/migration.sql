ALTER TABLE "plan_page_version" ADD COLUMN "source_path" text;--> statement-breakpoint
CREATE INDEX "plan_page_version_source_path" ON "plan_page_version" ("source_path");