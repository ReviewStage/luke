ALTER TABLE "plan" ADD COLUMN "organization_id" text;--> statement-breakpoint
CREATE INDEX "plan_organization_created" ON "plan" ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;